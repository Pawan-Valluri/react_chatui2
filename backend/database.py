import os
import json
from datetime import datetime
import uuid
from sqlalchemy import create_engine, Column, String, DateTime, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./apcot_chat.db")

# Create SQLAlchemy engine and session
# For SQLite, we add connect_args={"check_same_thread": False}
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Thread(Base):
    __tablename__ = "threads"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False, default="New Chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String, nullable=True, index=True)

    messages = relationship("Message", back_populates="thread", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "user_id": self.user_id
        }

class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    thread_id = Column(String, ForeignKey("threads.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(String, ForeignKey("messages.id", ondelete="CASCADE"), nullable=True)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)  # JSON-encoded array of message parts
    created_at = Column(DateTime, default=datetime.utcnow)

    thread = relationship("Thread", back_populates="messages")

    def to_dict(self):
        try:
            parsed_content = json.loads(self.content)
        except Exception:
            parsed_content = [{"type": "text", "text": self.content}]
            
        return {
            "id": self.id,
            "thread_id": self.thread_id,
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
    # Check if user_id column exists in threads, if not, alter table dynamically
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('threads')]
        if 'user_id' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE threads ADD COLUMN user_id VARCHAR"))
    except Exception as e:
        print("Database migration (adding user_id) skipped or error:", e)
