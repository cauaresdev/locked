FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml alembic.ini ./
COPY knightfall ./knightfall
RUN pip install --no-cache-dir ".[postgres]"
EXPOSE 8000
# Migrations run on startup (Database.migrate in the app lifespan).
CMD ["uvicorn", "knightfall.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
