use epub::doc::EpubDoc;
use std::path::Path;

/// Result for one spine item (chapter)
pub struct ChapterContent {
    pub index: usize,
    pub title: String,
    pub text: String,
}

/// Extract all chapter text, TOC, and Dublin Core metadata from an EPUB file (single open).
pub fn extract_chapters(path: &str) -> Result<(Vec<ChapterContent>, usize, Vec<(String, u32)>, Option<String>, Option<String>), String> {
    let mut doc = EpubDoc::new(Path::new(path))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;

    // Extract metadata from the opened doc before consuming it for chapters
    let get_val = |key: &str| doc.metadata.iter().find(|m| m.property == key).map(|m| m.value.clone()).filter(|s| !s.is_empty());
    let meta_title = get_val("title");
    let meta_author = get_val("creator");

    let total = doc.spine.len();

    // Collect spine item IDs to avoid borrow conflicts
    let spine_ids: Vec<String> = doc.spine.iter().map(|item| item.idref.clone()).collect();

    // Collect flattened TOC titles in order
    let toc_titles: Vec<String> = {
        let mut t = Vec::new();
        collect_toc_titles(&doc.toc, &mut t);
        t
    };

    // Build toc entries
    let mut toc = Vec::new();
    flatten_nav(&doc.toc, 0, &mut toc);

    let mut chapters = Vec::new();

    for (i, idref) in spine_ids.iter().enumerate() {
        let html = doc
            .get_resource_str(idref)
            .map(|(text, _)| text)
            .unwrap_or_default();

        let title = toc_titles
            .get(i)
            .cloned()
            .unwrap_or_else(|| format!("Chapter {}", i + 1));

        let text = strip_html(&html);
        chapters.push(ChapterContent { index: i, title, text });
    }

    Ok((chapters, total, toc, meta_title, meta_author))
}

/// Recursively collect all TOC labels in depth-first order.
fn collect_toc_titles(nav: &[epub::doc::NavPoint], result: &mut Vec<String>) {
    for point in nav {
        result.push(point.label.clone());
        collect_toc_titles(&point.children, result);
    }
}

/// Extract TOC from EPUB navigation.
pub fn extract_toc(path: &str) -> Result<Vec<(String, u32)>, String> {
    let doc = EpubDoc::new(Path::new(path))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;

    let mut toc = Vec::new();
    flatten_nav(&doc.toc, 0, &mut toc);
    Ok(toc)
}

fn flatten_nav(nav: &[epub::doc::NavPoint], level: u32, result: &mut Vec<(String, u32)>) {
    for point in nav {
        result.push((point.label.clone(), level));
        flatten_nav(&point.children, level + 1, result);
    }
}

fn strip_html(html: &str) -> String {
    use scraper::Html;

    let with_blocks = html
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</h4>", "\n")
        .replace("</h5>", "\n")
        .replace("</h6>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</li>", "\n")
        .replace("</tr>", "\n");

    let fragment = Html::parse_fragment(&with_blocks);
    let text: String = fragment.root_element().text().collect();

    let text = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    let text: Vec<&str> = text.split_whitespace().collect();
    text.join(" ")
}
