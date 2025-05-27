# backend/app.py
import os
import sys # Cho sys.platform khi check admin
import ctypes # Check admin win
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Tai bien .env o goc (CAN CHAY TRUOC KHI IMPORT CAC MODULE KHAC NEU CHUNG DUNG BIEN ENV)
load_dotenv(dotenv_path='../.env')

# Khoi tao Flask app
app = Flask(__name__) # Doi tuong app duoc tao o day
CORS(app, resources={r"/api/*": {"origins": "http://localhost:5174"}}) # Cho phep CORS từ port 5174

# --- Cau hinh & Constants (cac module khac se import tu day) ---
# Dua config vao app.config de current_app co the truy cap
app.config['GOOGLE_API_KEY'] = os.getenv('GOOGLE_API_KEY')
app.config['PROMPT_DATA_DIR'] = os.path.join(os.path.dirname(__file__), 'prompt_data')
app.config['PROMPTS_DIR'] = os.path.join(app.config['PROMPT_DATA_DIR'], 'prompts')
app.config['SAFETY_SETTINGS_MAP'] = {
    "BLOCK_NONE": [{"category": c, "threshold": "BLOCK_NONE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_ONLY_HIGH": [{"category": c, "threshold": "BLOCK_ONLY_HIGH"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_MEDIUM_AND_ABOVE": [{"category": c, "threshold": "BLOCK_MEDIUM_AND_ABOVE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
    "BLOCK_LOW_AND_ABOVE": [{"category": c, "threshold": "BLOCK_LOW_AND_ABOVE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]],
}
# --- Het Constants ---

# Import va dang ky Blueprint cho routes
# Import sau khi 'app' va app.config da duoc khoi tao
from .routes import api_bp
app.register_blueprint(api_bp)

# --- Cau hinh Logging ---
# Chi cau hinh file logger khi KHONG o che do debug (de tranh loi voi reloader)
if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
    if not os.path.exists('../logs'): # Tao thu muc logs o goc du an
        os.makedirs('../logs', exist_ok=True)
    # Duong dan file log tuyet doi den thu muc logs o goc
    log_file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'logs', 'gemini_executor.log'))

    file_handler = RotatingFileHandler(log_file_path, maxBytes=102400, backupCount=10, encoding='utf-8')
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    # Muc log cua handler co the khac muc log cua app
    # VD: app.logger.setLevel(logging.DEBUG) nhung handler chi ghi INFO tro len
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    # Dat muc log cho app logger sau khi them handler
    if not app.logger.level or app.logger.level > logging.INFO:
        app.logger.setLevel(logging.INFO)
else:
    # Neu dang debug mode va CHUA phai la main process cua reloader,
    # co the khong can handler file, hoac su dung handler khac
    # Trong truong hop nay, de don gian, chi log ra console (mac dinh cua Flask)
    app.logger.setLevel(logging.DEBUG) # Log DEBUG ra console khi debug

# --- Main Execution ---
if __name__ == '__main__':
    # Thong bao khoi dong duoc log truoc khi app.run
    # De dam bao no duoc ghi boi logger da cau hinh (neu co)
    app.logger.info('Backend Gemini UI Executor dang khoi dong...')
    print("Backend đang chạy tại http://localhost:5001")

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
        except Exception:
            warn_msg = "Ko the check quyen admin khi khoi dong."
            app.logger.warning(warn_msg)
            print(f"[CẢNH BÁO] {warn_msg}")
    # Tham so use_reloader=False khi debug tren Windows co the giup tranh loi permission voi file log
    # Tuy nhien, dieu nay se mat tinh nang auto-reload.
    # Cach tot hon la dieu kien WERKZEUG_RUN_MAIN nhu tren.
    app.run(debug=True, port=5001)