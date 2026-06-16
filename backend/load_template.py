import sys
import hashlib
from app.config import DEFAULT_TEMPLATE_ID
from database import SessionLocal, DocumentTemplate, parse_docx_numbering
from docx import Document

def create_empty_docx(path):
    doc = Document()
    doc.add_paragraph("Default Template Content")
    doc.save(path)

def load_template(docx_path=None):
    session = SessionLocal()
    
    if not docx_path:
        print("No docx path provided, generating a default empty template...")
        docx_path = "default_template.docx"
        create_empty_docx(docx_path)
    
    try:
        with open(docx_path, "rb") as f:
            docx_blob = f.read()
    except Exception as e:
        print(f"Error reading {docx_path}: {e}")
        return

    theme_hash = hashlib.sha256(docx_blob).hexdigest()
    numbering_json = parse_docx_numbering(docx_blob)
    
    # Check if default template already exists
    existing = session.query(DocumentTemplate).filter(DocumentTemplate.id == DEFAULT_TEMPLATE_ID).first()
    
    if existing:
        print(f"Updating existing template with ID: {DEFAULT_TEMPLATE_ID}")
        existing.docx_blob = docx_blob
        existing.theme_hash = theme_hash
        existing.numbering_json = numbering_json
        existing.styles_json = "[]"
    else:
        print(f"Creating new template with ID: {DEFAULT_TEMPLATE_ID}")
        new_template = DocumentTemplate(
            id=DEFAULT_TEMPLATE_ID,
            version_name="Default Version",
            docx_blob=docx_blob,
            styles_json="[]",
            theme_hash=theme_hash,
            numbering_json=numbering_json
        )
        session.add(new_template)
        
    session.commit()
    print("Template loaded successfully.")

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    load_template(path)
