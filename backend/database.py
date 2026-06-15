import os
import json
from datetime import datetime
import uuid
from sqlalchemy import create_engine, Column, String, DateTime, ForeignKey, Text, LargeBinary
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./apcot_chat.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class DocumentTemplate(Base):
    __tablename__ = "templates"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    version_name = Column(String, nullable=False)
    docx_blob = Column(LargeBinary, nullable=False)
    styles_json = Column(Text, nullable=False)
    theme_hash = Column(String, index=True, nullable=True)
    numbering_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Thread(Base):
    __tablename__ = "threads"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False, default="New Chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String, nullable=True, index=True)

    messages = relationship("Message", back_populates="thread", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="thread", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user_id": self.user_id
        }

class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id = Column(String, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False)
    template_id = Column(String, ForeignKey("templates.id"), nullable=True) # Nullable for legacy support initially
    theme_hash = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    latest_snapshot = Column(LargeBinary, nullable=True)

    thread = relationship("Thread", back_populates="documents")
    template = relationship("DocumentTemplate")

class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id = Column(String, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=True) # Link message directly to a document context
    parent_id = Column(String, ForeignKey("messages.id", ondelete="CASCADE"), nullable=True)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)  # JSON-encoded array of message parts
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # CRDT Fields
    delta_blob = Column(LargeBinary, nullable=True)
    checkpoint_snapshot = Column(LargeBinary, nullable=True)

    thread = relationship("Thread", back_populates="messages")
    document = relationship("Document")

    def to_dict(self):
        try:
            parsed_content = json.loads(self.content)
        except Exception:
            parsed_content = [{"type": "text", "text": self.content}]
            
        return {
            "id": self.id,
            "thread_id": self.thread_id,
            "document_id": self.document_id,
            "parentId": self.parent_id,
            "role": self.role,
            "content": parsed_content,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def parse_docx_numbering(docx_blob: bytes) -> str:
    import zipfile
    import io
    import xml.etree.ElementTree as ET
    try:
        with zipfile.ZipFile(io.BytesIO(docx_blob)) as z:
            if "word/numbering.xml" not in z.namelist():
                return "{}"
            
            xml_content = z.read("word/numbering.xml")
            root = ET.fromstring(xml_content)
            
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            
            abstract_nums = {}
            for abstract_num in root.findall("w:abstractNum", ns):
                abs_id = abstract_num.attrib.get(f"{{{ns['w']}}}abstractNumId")
                if not abs_id:
                    continue
                
                levels = {}
                for lvl in abstract_num.findall("w:lvl", ns):
                    ilvl = lvl.attrib.get(f"{{{ns['w']}}}ilvl")
                    if not ilvl:
                        continue
                    
                    num_fmt = lvl.find("w:numFmt", ns)
                    lvl_text = lvl.find("w:lvlText", ns)
                    
                    levels[ilvl] = {
                        "numFmt": num_fmt.attrib.get(f"{{{ns['w']}}}val") if num_fmt is not None else "decimal",
                        "lvlText": lvl_text.attrib.get(f"{{{ns['w']}}}val") if lvl_text is not None else "%1",
                    }
                abstract_nums[abs_id] = levels
                
            nums = {}
            for num in root.findall("w:num", ns):
                num_id = num.attrib.get(f"{{{ns['w']}}}numId")
                if not num_id:
                    continue
                
                abs_num_id_el = num.find("w:abstractNumId", ns)
                abs_num_id = abs_num_id_el.attrib.get(f"{{{ns['w']}}}val") if abs_num_id_el is not None else None
                
                if abs_num_id:
                    nums[num_id] = {
                        "abstractNumId": abs_num_id,
                    }
            
            return json.dumps({
                "abstractNums": abstract_nums,
                "nums": nums
            })
    except Exception as e:
        print("Failed to parse numbering.xml:", e)
        return "{}"

# Create tables
def init_db():
    Base.metadata.create_all(bind=engine)
    # Perform lightweight migration for SQLite additive columns
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        
        # Add user_id to threads
        thread_cols = [col['name'] for col in inspector.get_columns('threads')]
        if 'user_id' not in thread_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE threads ADD COLUMN user_id VARCHAR"))
                
        # Add CRDT columns to messages
        msg_cols = [col['name'] for col in inspector.get_columns('messages')]
        with engine.begin() as conn:
            if 'document_id' not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN document_id VARCHAR REFERENCES documents(id) ON DELETE CASCADE"))
            if 'delta_blob' not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN delta_blob BLOB"))
            if 'checkpoint_snapshot' not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN checkpoint_snapshot BLOB"))
                
        # Add theme_hash to templates
        tpl_cols = [col['name'] for col in inspector.get_columns('templates')]
        if 'theme_hash' not in tpl_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE templates ADD COLUMN theme_hash VARCHAR"))
                
        # Add numbering_json to templates
        if 'numbering_json' not in tpl_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE templates ADD COLUMN numbering_json TEXT"))
                
        # Add theme_hash to documents
        doc_cols = [col['name'] for col in inspector.get_columns('documents')]
        if 'theme_hash' not in doc_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE documents ADD COLUMN theme_hash VARCHAR"))
                
        # Populate theme_hash and numbering_json for existing templates
        with SessionLocal() as session:
            templates = session.query(DocumentTemplate).all()
            updated = False
            for t in templates:
                if not t.theme_hash:
                    import hashlib
                    t.theme_hash = hashlib.sha256(t.docx_blob).hexdigest()
                    updated = True
                if not t.numbering_json:
                    t.numbering_json = parse_docx_numbering(t.docx_blob)
                    updated = True
            if updated:
                session.commit()
                print("Updated template metadata (theme_hash, numbering_json).")
    except Exception as e:
        print("Database migration skipped or error:", e)
