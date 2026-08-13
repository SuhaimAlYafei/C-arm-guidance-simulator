from .api import app
from .synthetic_xray import router

app.include_router(router)
