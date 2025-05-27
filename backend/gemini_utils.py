# backend/gemini_utils.py
import os
import re
import google.generativeai as genai
from google.generativeai.types import GenerationConfig
from flask import current_app # Su dung current_app de lay config va logger

# Ham goi Gemini API
def generate_response_from_gemini(full_prompt, model_config_param, is_for_review_or_debug=False):
    """Goi Gemini API va xu ly phan hoi."""
    logger = current_app.logger # Lay logger tu current_app
    # Lay config tu current_app.config
    google_api_key_cfg = current_app.config.get('GOOGLE_API_KEY')
    safety_settings_map_cfg = current_app.config.get('SAFETY_SETTINGS_MAP')
    
    ui_api_key = None

    if not isinstance(model_config_param, dict):
        logger.warning(f"model_config ko phai dict, ma la {type(model_config_param)}. Dung dict rong.")
        model_config_internal = {}
    else:
        model_config_internal = model_config_param.copy()

    try:
        ui_api_key = model_config_internal.pop('api_key', None)
        if ui_api_key and not ui_api_key.strip():
            ui_api_key = None

        effective_api_key = ui_api_key if ui_api_key else google_api_key_cfg

        if not effective_api_key:
            logger.error("API Key thieu (ca .env va UI).")
            return "Lỗi cấu hình: Thiếu API Key. Vui lòng đặt GOOGLE_API_KEY trong .env hoặc nhập vào Cài đặt."

        try:
            genai.configure(api_key=effective_api_key)
            if ui_api_key:
                 logger.info("Dung API Key tu UI.")
        except Exception as config_e:
             key_source = "giao diện" if ui_api_key else ".env"
             logger.error(f"Loi config Gemini voi API Key tu {key_source}: {config_e}")
             error_detail = str(config_e)
             if "API key not valid" in error_detail:
                  return f"Lỗi cấu hình: API key từ {key_source} không hợp lệ. Vui lòng kiểm tra lại."
             else:
                  return f"Lỗi cấu hình: Không thể cấu hình Gemini với API key từ {key_source} ({error_detail})."

        model_name = model_config_internal.get('model_name', 'gemini-1.5-flash')
        if not model_name: model_name = 'gemini-1.5-flash'

        temperature = model_config_internal.get('temperature', 0.7)
        top_p = model_config_internal.get('top_p', 0.95)
        top_k = model_config_internal.get('top_k', 40)
        safety_setting_key = model_config_internal.get('safety_setting', 'BLOCK_MEDIUM_AND_ABOVE')
        safety_settings = safety_settings_map_cfg.get(safety_setting_key, safety_settings_map_cfg['BLOCK_MEDIUM_AND_ABOVE'])

        generation_config = GenerationConfig(
            temperature=float(temperature),
            top_p=float(top_p),
            top_k=int(top_k)
        )

        logger.info(f"Goi model: {model_name} voi config: T={temperature}, P={top_p}, K={top_k}, Safety={safety_setting_key}")
        model = genai.GenerativeModel(model_name=model_name)
        
        if full_prompt.startswith("Lỗi: Không thể tải template prompt"): 
            logger.error(f"Huy goi Gemini do: {full_prompt}")
            return full_prompt 

        response = model.generate_content(
            full_prompt,
            generation_config=generation_config,
            safety_settings=safety_settings
        )

        if not response.candidates and hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
            block_reason = response.prompt_feedback.block_reason.name
            safety_ratings_str = str(getattr(response.prompt_feedback, 'safety_ratings', 'Không có'))
            logger.warning(f"Phan hoi bi chan: {block_reason}. Ratings: {safety_ratings_str}")
            return f"Lỗi: Phản hồi bị chặn bởi cài đặt an toàn (Lý do: {block_reason}). Hãy thử điều chỉnh Safety Settings hoặc prompt."

        raw_text = response.text.strip()

        if is_for_review_or_debug and raw_text: 
             lines = raw_text.splitlines()
             cleaned_lines = []
             prefixes_to_remove = (
                 "đây là đánh giá", "here is the review", "phân tích code",
                 "review:", "analysis:", "đây là phân tích", "here is the analysis",
                 "giải thích và đề xuất:", "phân tích và đề xuất:",
                 "đây là giải thích", "here is the explanation", "giải thích:", "explanation:",
                 "```text"
             )
             first_meaningful_line = False
             for line in lines:
                 stripped_line_lower = line.strip().lower()
                 if stripped_line_lower.startswith(("[thinking", "[processing")) and stripped_line_lower.endswith("]"):
                     continue
                 if not first_meaningful_line and any(stripped_line_lower.startswith(p) for p in prefixes_to_remove):
                     continue
                 if line.strip():
                     first_meaningful_line = True
                 if first_meaningful_line:
                     cleaned_lines.append(line)
             final_text = "\n".join(cleaned_lines).strip()
             return final_text

        return raw_text

    except Exception as e:
        error_message = str(e)
        model_name_for_error = model_config_internal.get('model_name', 'unknown_model')
        logger.error(f"Loi API Gemini ({model_name_for_error}): {error_message}", exc_info=True)
        if "API key not valid" in error_message:
             key_source = "giao diện" if ui_api_key else ".env"
             return f"Lỗi cấu hình: API key từ {key_source} không hợp lệ. Vui lòng kiểm tra."
        elif "Could not find model" in error_message or "permission denied" in error_message.lower():
             return f"Lỗi cấu hình: Không tìm thấy hoặc không có quyền truy cập model '{model_name_for_error}'."
        elif "invalid" in error_message.lower() and any(p in error_message.lower() for p in ["temperature", "top_p", "top_k", "safety_settings"]):
             return f"Lỗi cấu hình: Giá trị tham số (Temperature/TopP/TopK/Safety) không hợp lệ. ({error_message})"
        elif "Deadline Exceeded" in error_message or "timeout" in error_message.lower():
             return f"Lỗi mạng: Yêu cầu tới Gemini API bị quá thời gian (timeout). Vui lòng thử lại."
        elif "SAFETY" in error_message.upper(): 
             details_match = re.search(r"Finish Reason: (\w+)", error_message)
             reason_detail = f" (Lý do: {details_match.group(1)})" if details_match else ""
             safety_ratings_match = re.search(r"Safety Ratings: \[(.+?)]", error_message, re.DOTALL)
             ratings_detail = f", Ratings: {safety_ratings_match.group(1)}" if safety_ratings_match else ""
             return f"Lỗi: Yêu cầu hoặc phản hồi có thể vi phạm chính sách an toàn của Gemini.{reason_detail}{ratings_detail} ({error_message[:100]}...)"
        return f"Lỗi máy chủ khi gọi Gemini: {error_message}"

    finally: 
        if ui_api_key and google_api_key_cfg and google_api_key_cfg != ui_api_key:
            try:
                genai.configure(api_key=google_api_key_cfg)
            except Exception as reset_e:
                logger.warning(f"Ko the reset API key global ve key .env: {reset_e}")
        elif ui_api_key and not google_api_key_cfg:
             pass 