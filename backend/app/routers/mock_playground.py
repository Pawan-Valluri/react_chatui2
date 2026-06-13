from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import os

router = APIRouter()

@router.get("/api/mock-playground/doc")
async def get_playground_doc():
    # Use one of the test documents
    file_path = "storage/documents/test_save.docx"
    
    if not os.path.exists(file_path):
        # Fallback to looking in the templates dir or anywhere we can find a docx
        import glob
        files = glob.glob("storage/documents/*.docx")
        if files:
            file_path = files[0]
        else:
            raise HTTPException(status_code=404, detail="No template document found")
            
    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="template.docx"
    )
