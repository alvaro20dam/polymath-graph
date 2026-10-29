# Imagen unificada: API FastAPI + frontend estático en un solo contenedor.
#   docker build -t polymath-graph .
#   docker run -p 8000:8000 polymath-graph      ->  http://localhost:8000
FROM node:22-alpine AS web
WORKDIR /repo
COPY data ./data
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install --no-audit --no-fund
COPY frontend ./frontend
RUN cd frontend && npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 POLYMATH_DATA_DIR=/app/data POLYMATH_STATIC_DIR=/app/static
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY data ./data
COPY --from=web /repo/frontend/dist ./static
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
