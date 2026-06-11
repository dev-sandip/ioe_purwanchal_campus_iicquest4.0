# Use an official lightweight Python image
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application files
COPY . .

# Hugging Face Spaces run as user 1000 for security
RUN useradd -m -u 1000 user
RUN chown -R user:user /app
USER user

# Set environment paths
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Expose the default port for Hugging Face Spaces
EXPOSE 7860

# Command to run uvicorn on port 7860
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7860"]
