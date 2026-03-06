# FlareSolverr on Hugging Face Spaces
# HF Spaces requires the app to listen on port 7860.
# FlareSolverr respects the PORT env var, so we just set it here.

FROM ghcr.io/flaresolverr/flaresolverr:latest

# Override default port (8191) to match HF Spaces expected port
ENV PORT=7860
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV CAPTCHA_SOLVER=none

EXPOSE 7860
