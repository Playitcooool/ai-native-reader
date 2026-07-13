/// Extract title and author from a PDF without loading the full document.
pub fn extract_metadata(file_path: &str) -> (Option<String>, Option<String>) {
    lopdf::Document::load_metadata(file_path)
        .map(|metadata| {
            (
                metadata.title.filter(|value| !value.is_empty()),
                metadata.author.filter(|value| !value.is_empty()),
            )
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    #[test]
    fn reads_pdf_metadata_without_loading_pages() {
        let path = std::env::temp_dir().join(format!(
            "rustybooks-pdf-metadata-{}.pdf",
            uuid::Uuid::new_v4()
        ));
        let mut document = Document::with_version("1.7");
        let info = document.add_object(dictionary! {
            "Title" => Object::string_literal("Release test"),
            "Author" => Object::string_literal("RustyBooks"),
        });
        document.trailer.set("Info", info);
        document.save(&path).unwrap();

        let metadata = extract_metadata(path.to_str().unwrap());
        std::fs::remove_file(path).unwrap();

        assert_eq!(
            metadata,
            (Some("Release test".into()), Some("RustyBooks".into()))
        );
    }
}
