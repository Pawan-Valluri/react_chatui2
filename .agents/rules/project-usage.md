---
trigger: always_on
---

the subprojects(frontend,backend,authblue-simulator) should be executed in their own folder.
like for frontend:
```
cd frontend
npm run dev
```
for backend
```
cd backend
python main.py    # you can replace `python` with correct path to python for the env if needed
```