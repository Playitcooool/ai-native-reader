use std::fs;

pub const RESELECT_MESSAGE: &str = "Please reselect this file or folder to restore access.";

pub fn read(path: &str, bookmark: Option<&[u8]>) -> Result<Vec<u8>, String> {
    with_access(path, bookmark, || {
        fs::read(path).map_err(|e| format!("Failed to read document at {}: {}", path, e))
    })
}

pub fn with_access<T>(
    path: &str,
    bookmark: Option<&[u8]>,
    op: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _access = AccessGuard::new(path, bookmark)?;
    match op() {
        Ok(value) => Ok(value),
        Err(error) if error.to_lowercase().contains("permission denied") => {
            Err(RESELECT_MESSAGE.to_string())
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn create_bookmark(_path: &str, _is_directory: bool) -> Option<Vec<u8>> {
    None
}

#[cfg(not(target_os = "macos"))]
struct AccessGuard;

#[cfg(not(target_os = "macos"))]
impl AccessGuard {
    fn new(_path: &str, _bookmark: Option<&[u8]>) -> Result<Self, String> {
        Ok(Self)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::RESELECT_MESSAGE;
    use core_foundation::base::{kCFAllocatorDefault, TCFType};
    use core_foundation::data::CFData;
    use core_foundation::url::CFURL;
    use core_foundation_sys::base::Boolean;
    use core_foundation_sys::error::CFErrorRef;
    use core_foundation_sys::url::{
        kCFURLBookmarkCreationSecurityScopeAllowOnlyReadAccess,
        kCFURLBookmarkCreationWithSecurityScope, kCFURLBookmarkResolutionWithSecurityScope,
        kCFURLBookmarkResolutionWithoutUIMask, CFURLCreateBookmarkData,
        CFURLCreateByResolvingBookmarkData, CFURLStartAccessingSecurityScopedResource,
        CFURLStopAccessingSecurityScopedResource,
    };
    use std::path::Path;
    use std::ptr;

    pub(super) struct AccessGuard {
        url: Option<CFURL>,
    }

    impl AccessGuard {
        pub(super) fn new(path: &str, bookmark: Option<&[u8]>) -> Result<Self, String> {
            let Some(bookmark) = bookmark.filter(|b| !b.is_empty()) else {
                return Ok(Self { url: None });
            };
            let data = CFData::from_buffer(bookmark);
            let mut stale: Boolean = 0;
            let mut error: CFErrorRef = ptr::null_mut();
            let url_ref = unsafe {
                CFURLCreateByResolvingBookmarkData(
                    kCFAllocatorDefault,
                    data.as_concrete_TypeRef(),
                    kCFURLBookmarkResolutionWithSecurityScope
                        | kCFURLBookmarkResolutionWithoutUIMask,
                    ptr::null(),
                    ptr::null(),
                    &mut stale,
                    &mut error,
                )
            };
            if url_ref.is_null() || stale != 0 {
                return Err(format!("{RESELECT_MESSAGE} ({path})"));
            }
            let url = unsafe { CFURL::wrap_under_create_rule(url_ref) };
            let started =
                unsafe { CFURLStartAccessingSecurityScopedResource(url.as_concrete_TypeRef()) };
            if started == 0 {
                return Err(format!("{RESELECT_MESSAGE} ({path})"));
            }
            Ok(Self { url: Some(url) })
        }
    }

    impl Drop for AccessGuard {
        fn drop(&mut self) {
            if let Some(url) = &self.url {
                unsafe { CFURLStopAccessingSecurityScopedResource(url.as_concrete_TypeRef()) };
            }
        }
    }

    pub fn create_bookmark(path: &str, is_directory: bool) -> Option<Vec<u8>> {
        let url = CFURL::from_path(Path::new(path), is_directory)?;
        let mut error: CFErrorRef = ptr::null_mut();
        let data_ref = unsafe {
            CFURLCreateBookmarkData(
                kCFAllocatorDefault,
                url.as_concrete_TypeRef(),
                kCFURLBookmarkCreationWithSecurityScope
                    | kCFURLBookmarkCreationSecurityScopeAllowOnlyReadAccess,
                ptr::null(),
                ptr::null(),
                &mut error,
            )
        };
        if data_ref.is_null() {
            return None;
        }
        let data = unsafe { CFData::wrap_under_create_rule(data_ref) };
        Some(data.bytes().to_vec())
    }
}

#[cfg(target_os = "macos")]
use macos::AccessGuard;

#[cfg(target_os = "macos")]
pub use macos::create_bookmark;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_bookmark_falls_back_to_plain_read() {
        let path = std::env::temp_dir().join(format!("rustybooks-access-{}", std::process::id()));
        fs::write(&path, b"ok").unwrap();
        let data = read(path.to_str().unwrap(), None).unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(data, b"ok");
    }
}
