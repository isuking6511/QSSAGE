FROM python:3.12

WORKDIR /app

COPY sandbox_app.py .

RUN pip install flask requests

ENV PYTHONUNBUFFERED=1

CMD ["python", "sandbox_app.py"]