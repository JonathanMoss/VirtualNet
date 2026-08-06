FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python & Node dependencies
COPY requirements.txt package.json ./
RUN pip install --no-cache-dir -r requirements.txt && npm install --no-audit

# Copy source code
COPY app/ app/
COPY static/ static/
COPY docs/ docs/
COPY tests/ tests/

EXPOSE 5000

# Run with eventlet worker for SocketIO support
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "-b", "0.0.0.0:5000", "app:create_app()"]
