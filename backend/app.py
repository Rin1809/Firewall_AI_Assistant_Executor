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
CORS(app, resources={r"/api/*": {"origins": "http://localhost:5173"}}) # Cho phep CORS

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

# --- Main Execution ---
if __name__ == '__main__':
    if not app.debug: 
        if not os.path.exists('logs'):
            os.mkdir('logs')
        file_handler = RotatingFileHandler('logs/gemini_executor.log', maxBytes=102400, backupCount=10)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        file_handler.setLevel(logging.INFO) 
        app.logger.addHandler(file_handler)
        app.logger.setLevel(logging.INFO) 

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
    
    app.run(debug=True, port=5001) 