import JSZip from "jszip";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ZIP_ENTRY_DATE = new Date("2024-01-01T00:00:00.000Z");
const XMLNS_WORDPROCESSING =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XMLNS_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

type DocxParagraph =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string };

export const DOCX_ROUNDTRIP_FIXTURE = {
  fileName: "import-roundtrip.docx",
  mimeType: DOCX_MIME_TYPE,
  heading: "DOCX Roundtrip Heading",
  paragraph: "An imported DOCX paragraph of body text.",
  bullets: ["First imported DOCX bullet", "Second imported DOCX bullet"],
} as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphXml(paragraph: DocxParagraph): string {
  const textRun = `<w:r><w:t>${escapeXml(paragraph.text)}</w:t></w:r>`;
  if (paragraph.kind === "heading") {
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${textRun}</w:p>`;
  }
  if (paragraph.kind === "bullet") {
    return [
      "<w:p>",
      '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
      textRun,
      "</w:p>",
    ].join("");
  }
  return `<w:p>${textRun}</w:p>`;
}

function documentXml(): string {
  const paragraphs: DocxParagraph[] = [
    { kind: "heading", text: DOCX_ROUNDTRIP_FIXTURE.heading },
    { kind: "paragraph", text: DOCX_ROUNDTRIP_FIXTURE.paragraph },
    ...DOCX_ROUNDTRIP_FIXTURE.bullets.map((text) => ({
      kind: "bullet" as const,
      text,
    })),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${XMLNS_WORDPROCESSING}">`,
    "<w:body>",
    ...paragraphs.map(paragraphXml),
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");
}

function contentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    "</Types>",
  ].join("");
}

function packageRelationshipsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Relationships xmlns="${XMLNS_RELATIONSHIPS}">`,
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>",
  ].join("");
}

function stylesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${XMLNS_WORDPROCESSING}">`,
    '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1">',
    '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>',
    '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>',
    "</w:style>",
    "</w:styles>",
  ].join("");
}

function numberingXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:numbering xmlns:w="${XMLNS_WORDPROCESSING}">`,
    '<w:abstractNum w:abstractNumId="0">',
    '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>',
    "</w:abstractNum>",
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    "</w:numbering>",
  ].join("");
}

function addXml(zip: JSZip, path: string, xml: string): void {
  zip.file(path, xml, { createFolders: false, date: ZIP_ENTRY_DATE });
}

export async function createDocxRoundtripFixture(): Promise<Buffer> {
  const zip = new JSZip();
  addXml(zip, "[Content_Types].xml", contentTypesXml());
  addXml(zip, "_rels/.rels", packageRelationshipsXml());
  addXml(zip, "word/document.xml", documentXml());
  addXml(zip, "word/styles.xml", stylesXml());
  addXml(zip, "word/numbering.xml", numberingXml());
  addXml(
    zip,
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${XMLNS_RELATIONSHIPS}"/>`,
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
}
