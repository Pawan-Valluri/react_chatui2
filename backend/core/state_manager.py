import y_py as Y
from sqlalchemy.orm import Session
from database import Document, Message

class StateManager:
    """
    Manages Yjs DB transactions for the collaborative editor.
    """

    @staticmethod
    def load_latest(db: Session, document_id: str) -> bytes:
        """Fetches latest_snapshot from documents."""
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc and doc.latest_snapshot:
            return doc.latest_snapshot
        
        # Return empty Yjs doc binary if None
        new_ydoc = Y.YDoc()
        return Y.encode_state_vector(new_ydoc)

    @staticmethod
    def reconstruct_state(db: Session, document_id: str, message_id: str) -> bytes:
        """
        Reconstructs state at a specific message by applying deltas.
        """
        # TODO: Implement delta application logic using Y.apply_update
        pass

    @staticmethod
    def commit_transaction(db: Session, message_id: str, document_id: str, delta_blob: bytes, latest_snapshot: bytes):
        """Executes the all-or-nothing database write."""
        # Update the delta on the corresponding message
        msg = db.query(Message).filter(Message.id == message_id).first()
        if msg:
            msg.document_id = document_id
            msg.delta_blob = delta_blob
            
            # Periodically snapshot (e.g. every 10 messages) could be implemented here
            # msg.checkpoint_snapshot = ...
            
        # Update the document's latest snapshot
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.latest_snapshot = latest_snapshot
            
        db.commit()
