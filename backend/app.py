# backend/app.py
import os
import sys # Cho sys.platform khi check admin
import ctypes # Check admin win
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai # Them import genai

# Tai bien .env o goc (CAN CHAY TRUOC KHI IMPORT CAC MODULE KHAC NEU CHUNG DUNG BIEN ENV)
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env') # Duong dan chinh xac den .env o goc
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
    print(f"Da load bien moi truong tu: {dotenv_path}")
else:
    print(f"Khong tim thay file .env tai: {dotenv_path}. Su dung bien he thong (neu co).")


# Khoi tao Flask app
app = Flask(__name__) # Doi tuong app duoc tao o day
CORS(app, resources={r"/api/*": {"origins": "http://localhost:5174"}}) # Cho phep CORS từ port 5174

# --- Cau hinh & Constants (cac module khac se import tu day) ---
app.config['GOOGLE_API_KEY'] = os.getenv('GOOGLE_API_KEY')
app.config['PROMPT_DATA_DIR'] = os.path.join(os.path.dirname(__file__), 'prompt_data')
app.config['PROMPTS_DIR'] = os.path.join(app.config['PROMPT_DATA_DIR'], 'prompts')
app.config['SAFETY_SETTINGS_MAP'] = {
    "BLOCK_NONE": [{"category": c, "threshold": "BLOCK_NONE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_ONLY_HIGH": [{"category": c, "threshold": "BLOCK_ONLY_HIGH"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_MEDIUM_AND_ABOVE": [{"category": c, "threshold": "BLOCK_MEDIUM_AND_ABOVE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_LOW_AND_ABOVE": [{"category": c, "threshold": "BLOCK_LOW_AND_ABOVE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
}

# Cau hinh GenAI key ngay khi app khoi tao (neu key co san trong env)
# Viec nay giup cac module khac (nhu routes) co the su dung genai.GenerativeModel ngay
# ma khong can goi genai.configure() moi lan.
# Trong routes, neu co UI API Key, se configure lai tam thoi.
if app.config['GOOGLE_API_KEY']:
    try:
        genai.configure(api_key=app.config['GOOGLE_API_KEY'])
        print("Da cau hinh Google GenAI voi API Key tu .env.")
    except Exception as e_genai_init:
        print(f"[CANH BAO] Khong the cau hinh Google GenAI ban dau: {e_genai_init}")
else:
    print("[CANH BAO] GOOGLE_API_KEY khong duoc tim thay trong moi truong. AI se khong hoat dong neu khong cung cap key qua UI.")


# --- Het Constants ---

# Import va dang ky Blueprint cho routes
# Import sau khi 'app' va app.config da duoc khoi tao
from .routes import api_bp # Su dung relative import
app.register_blueprint(api_bp)

# --- Cau hinh Logging ---
# Duong dan tuyet doi den thu muc logs o goc du an
project_root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
logs_dir_path = os.path.join(project_root_dir, 'logs')
log_file_path = os.path.join(logs_dir_path, 'gemini_executor.log')

# Chi cau hinh file logger khi KHONG o che do debug (de tranh loi voi reloader)
# HOAC khi la main process cua Werkzeug reloader.
if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
    # Dam bao thu muc logs ton tai truoc khi tao Handler
    if not os.path.exists(logs_dir_path):
        try:
            os.makedirs(logs_dir_path)
            print(f"Da tao thu muc logs: {logs_dir_path}")
        except OSError as e:
            print(f"[LOI] Khong the tao thu muc logs '{logs_dir_path}': {e}. Logging vao file co the se loi.")
            # Trong truong hop nay, co the khong add FileHandler hoac fallback ra console.
            # Tuy nhien, RotatingFileHandler van se duoc khoi tao va co the gay loi sau do.
            # De an toan, co the khong add handler neu tao dir that bai.
            # For now, let it try and potentially fail, as the original code did.

    if os.path.isdir(logs_dir_path): # Chi tao handler neu dir ton tai (hoac vua tao thanh cong)
        file_handler = RotatingFileHandler(log_file_path, maxBytes=102400, backupCount=10, encoding='utf-8')
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        file_handler.setLevel(logging.INFO) # Muc log cua handler
        app.logger.addHandler(file_handler)
        if not app.logger.level or app.logger.level > logging.INFO: # Dat muc log cho app logger
            app.logger.setLevel(logging.INFO)
        print(f"Logging vao file: {log_file_path}")
    else:
        print(f"[CANH BAO] Thu muc logs '{logs_dir_path}' khong ton tai va khong the tao. Logging se chi ra console.")
        app.logger.setLevel(logging.DEBUG) # Log ra console

else:
    # Neu dang debug mode va CHUA phai la main process cua reloader
    app.logger.setLevel(logging.DEBUG) # Log DEBUG ra console khi debug
    print("Dang o che do Debug (Werkzeug reloader child process), logging chi ra console.")


# --- Main Execution ---
if __name__ == '__main__':
    app.logger.info('Backend Gemini UI Executor dang khoi dong...')
    print("Backend dang chay tai http://localhost:5001")

    if sys.platform == "win32":
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
            if is_admin:
                admin_msg = "Backend dang chay voi quyen Administrator."
                app.logger.info(admin_msg)
                print(f"[INFO] {admin_msg}")
            else:
                user_msg = "Backend dang chay voi quyen User thong thuong."
                app.logger.info(user_msg)
                print(f"[INFO] {user_msg}")
        except Exception as e_admin_check:
            warn_msg = f"Ko the check quyen admin khi khoi dong: {e_admin_check}"
            app.logger.warning(warn_msg)
            print(f"[CANH BAO] {warn_msg}")

    app.run(debug=True, port=5001) # use_reloader mac dinh la True khi debug=True