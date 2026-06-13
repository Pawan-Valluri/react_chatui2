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
    except Exception as e:
        print("Database migration skipped or error:", e)
