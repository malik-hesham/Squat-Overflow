# Pose server image for Fly.io (see fly.toml and docs/deployment.md).
# Bookworm pinned so the apt package names below stay valid (trixie renamed libglib2.0-0).
FROM python:3.12-slim-bookworm

# libmediapipe.so links libEGL/libGLESv2 even for CPU inference; opencv-contrib-python
# (a MediaPipe dependency, not headless) loads libGL and glib.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libegl1 libgles2 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# MPLCONFIGDIR: MediaPipe's vision package imports matplotlib, which needs a writable config dir.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# The pose model is committed under models/, so nothing is downloaded at boot.
COPY . .

RUN useradd --system --no-create-home app
USER app

ARG VERSION=dev
ENV FORMCOACH_VERSION=${VERSION}

EXPOSE 8080
# Frames are capped at 2 MB in app.py; --ws-max-size keeps uvicorn from buffering anything much larger.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips=*", "--ws-max-size", "3000000"]
