# Firewall AI Assistant  - Executor\backend\routes.py
import os
import sys
import subprocess
import shlex
import re
import json
from datetime import datetime
from flask import request, jsonify, Blueprint, current_app
import logging # Ensure logging is imported for isinstance check
import logging.handlers # Ensure handlers are imported for isinstance check
import glob # For finding the latest log file if needed, though current setup is one file.


import google.generativeai as genai
from google.generativeai.types import GenerationConfig, SafetySettingDict, HarmCategory
from google.generativeai import GenerativeModel

from .helpers import get_os_name, get_language_name
from .prompt_utils import (
    create_prompt, create_review_prompt,
    create_debug_prompt, create_explain_prompt
)
from .gemini_utils import generate_response_from_gemini
from .execution_utils import (
    extract_code_block, execute_fortigate_commands,
    execute_local_script, fetch_and_save_fortigate_context,
    DEFAULT_FORTIGATE_CONTEXT_COMMANDS
)

api_bp = Blueprint('api', __name__, url_prefix='/api')

AVAILABLE_TOOLS = [{
    "function_declarations": [
        {
            "name": "get_fortigate_data",
            "description": "Lấy thông tin cấu hình hoặc trạng thái cụ thể từ FortiGate bằng cách chạy một lệnh FortiOS CLI (ví dụ: 'show ...', 'get ...', 'diagnose ...'). Chỉ sử dụng cho các lệnh không thay đổi cấu hình. Không dùng để tạo, sửa, xóa cấu hình.",
            "parameters": {
                "type_": "OBJECT",
                "properties": {
                    "command": {
                        "type_": "STRING",
                        "description": "Lệnh FortiOS CLI cần thực thi để lấy thông tin. Ví dụ: 'show system interface port1', 'get router info routing-table all'."
                    }
                },
                "required": ["command"]
            }
        },
    ]
}]


def _normalize_model_config(raw_config: dict) -> dict:
    if not isinstance(raw_config, dict):
        return {}
    normalized = {}
    normalized['model_name'] = raw_config.get('modelName', raw_config.get('model_name'))
    temp = raw_config.get('temperature')
    if temp is not None:
        try: normalized['temperature'] = float(temp)
        except (ValueError, TypeError): pass
    top_p_val = raw_config.get('topP', raw_config.get('top_p'))
    if top_p_val is not None:
        try: normalized['top_p'] = float(top_p_val)
        except (ValueError, TypeError): pass
    top_k_val = raw_config.get('topK', raw_config.get('top_k'))
    if top_k_val is not None:
        try: normalized['top_k'] = int(top_k_val)
        except (ValueError, TypeError): pass
    normalized['safety_setting'] = raw_config.get('safetySetting', raw_config.get('safety_setting'))
    normalized['api_key'] = raw_config.get('api_key')
    return {k: v for k, v in normalized.items() if v is not None}


@api_bp.route('/generate', methods=['POST'])
def handle_generate():
    logger = current_app.logger
    data = request.get_json()
    user_input_prompt_str = data.get('prompt')
    raw_model_config_from_request = data.get('model_config', {})
    model_config = _normalize_model_config(raw_model_config_from_request)
    target_os_input = data.get('target_os', 'auto')
    file_type_input = data.get('file_type', 'py')
    fortigate_config_from_request = data.get('fortigate_config')
    fortigate_selected_context_commands = data.get('fortigate_selected_context_commands', DEFAULT_FORTIGATE_CONTEXT_COMMANDS)
    if not fortigate_selected_context_commands:
        fortigate_selected_context_commands = DEFAULT_FORTIGATE_CONTEXT_COMMANDS

    if not user_input_prompt_str:
        return jsonify({"error": "Vui lòng nhập yêu cầu."}), 400

    backend_os_name = get_os_name()
    target_os_name = target_os_input if target_os_input.lower() == 'fortios' else \
                     (backend_os_name if target_os_input == 'auto' else target_os_input)

    if '.' in file_type_input:
        file_extension = file_type_input.split('.')[-1].lower()
    else:
        file_extension = file_type_input.lower()
    if not file_extension or not (file_extension.isalnum() or file_extension == 'fortios'):
        file_extension = 'py'

    is_fortios_interactive_generate = (
        target_os_name.lower() == 'fortios' and
        (file_extension == 'fortios' or (file_type_input and "fortios" in file_type_input.lower()))
    )

    if is_fortios_interactive_generate:
        logger.info("Generate FGT (Interactive Mode): Bat dau xu ly voi Function Calling.")
        if not fortigate_config_from_request or not fortigate_config_from_request.get('ipHost') or not fortigate_config_from_request.get('username'):
            logger.warning("Generate FGT (FC): Thieu IP/Host hoac Username FortiGate trong Settings.")
            return jsonify({
                "error": "Lỗi: Thiếu IP/Host hoặc Username cho FortiGate trong Cài đặt. AI không thể lấy thông tin để tạo lệnh chính xác.",
                "thoughts": []
            }), 400

        initial_fortigate_context_str = "Thông tin ngữ cảnh FortiGate không thể lấy do lỗi cấu hình hoặc kết nối."
        try:
            initial_fortigate_context_str = fetch_and_save_fortigate_context(
                fortigate_config_from_request,
                commands_to_fetch=fortigate_selected_context_commands
            )
        except Exception as e_ctx:
            logger.error(f"Generate FGT (FC): Loi khi lay ngu canh ban dau: {e_ctx}")
            initial_fortigate_context_str = f"Lưu ý: Lỗi khi lấy ngữ cảnh FortiGate ban đầu: {str(e_ctx)}"

        full_prompt_for_gemini = create_prompt(
            user_input_prompt_str,
            backend_os_name,
            target_os_name,
            file_type_input,
            fortigate_context_data=initial_fortigate_context_str
        )
        if "get_fortigate_data" not in full_prompt_for_gemini:
             # Them huong dan neu tool get_fortigate_data chua co trong prompt mac dinh
             full_prompt_for_gemini += "\n\nQuan trọng: Nếu bạn cần thêm thông tin cấu hình hiện tại của FortiGate để hoàn thành yêu cầu, hãy sử dụng tool `get_fortigate_data` để chạy các lệnh 'show', 'get', hoặc 'diagnose' cần thiết. Chỉ sử dụng tool này cho các lệnh không thay đổi cấu hình."
        # Huong dan AI tu retry khi gap loi tool (nghe loi ma thu lai ngay)
        full_prompt_for_gemini += "\n**QUAN TRỌNG:** Nếu một lệnh thực thi qua tool `get_fortigate_data` trả về lỗi, bạn phải **NGAY LẬP TỨC** phân tích lỗi đó và thử lại tool `get_fortigate_data` với lệnh đã sửa đổi hoặc điều chỉnh cách tiếp cận. **KHÔNG** giải thích lỗi hoặc thông báo kế hoạch của bạn cho đến khi bạn đã thử lại tool và có kết quả mới. Mục tiêu là hoàn thành yêu cầu bằng cách thực thi lệnh tool thành công."

        genai_api_key_to_use = model_config.get('api_key') or current_app.config.get('GOOGLE_API_KEY')
        if not genai_api_key_to_use:
            return jsonify({"error": "API Key của Google chưa được cấu hình.", "thoughts": []}), 500
        try:
            genai.configure(api_key=genai_api_key_to_use)
            logger.info(f"Generate FGT (FC): Da (lai) cau hinh GenAI voi key {'tu UI' if model_config.get('api_key') else 'tu .env'}.")
        except Exception as e_cfg_genai:
            logger.error(f"Loi cau hinh GenAI (FC): {e_cfg_genai}")
            return jsonify({"error": f"Lỗi cấu hình thư viện Google GenAI: {e_cfg_genai}", "thoughts": []}), 500

        gemini_model_name = model_config.get('model_name', 'gemini-1.5-flash')
        # Su dung genai.types neu GenerationConfig, SafetySetting, HarmCategory gay loi import
        try:
            generation_config_obj = GenerationConfig(
                temperature=float(model_config.get('temperature', 0.7)),
                top_p=float(model_config.get('top_p', 0.95)),
                top_k=int(model_config.get('top_k', 40))
            )
            safety_setting_key = model_config.get('safety_setting', 'BLOCK_MEDIUM_AND_ABOVE')
            safety_settings_config = current_app.config.get('SAFETY_SETTINGS_MAP', {}).get(safety_setting_key, [])
            
            safety_settings_list = []
            for setting in safety_settings_config:
                category_name = setting['category'].replace("HARM_CATEGORY_", "")
                # Su dung genai.types.HarmCategory
                if hasattr(genai.types.HarmCategory, category_name): # Ktra HarmCategory tu genai.types
                    category_enum = getattr(genai.types.HarmCategory, category_name)
                    # Su dung genai.types.SafetySetting.HarmBlockThreshold
                    threshold_enum = getattr(genai.types.SafetySetting.HarmBlockThreshold, setting['threshold'])
                    # Su dung genai.types.SafetySetting
                    safety_settings_list.append(genai.types.SafetySetting(category=category_enum, threshold=threshold_enum))
                else:
                    logger.warning(f"Bo qua safety setting voi category khong hop le: {setting['category']}")
        except AttributeError as e_types_attr:
             logger.error(f"Loi AttributeError khi truy cap GenConfig/Safety/HarmCategory tu google.generativeai.types: {e_types_attr}. Thu import truc tiep tu genai.types")
             # Fallback to genai.types if direct import failed or attributes are not found
             generation_config_obj = genai.types.GenerationConfig(
                temperature=float(model_config.get('temperature', 0.7)),
                top_p=float(model_config.get('top_p', 0.95)),
                top_k=int(model_config.get('top_k', 40))
             )
             safety_setting_key = model_config.get('safety_setting', 'BLOCK_MEDIUM_AND_ABOVE')
             safety_settings_config = current_app.config.get('SAFETY_SETTINGS_MAP', {}).get(safety_setting_key, [])
             safety_settings_list = []
             for setting in safety_settings_config:
                category_name = setting['category'].replace("HARM_CATEGORY_", "")
                if hasattr(genai.types.HarmCategory, category_name):
                    category_enum = getattr(genai.types.HarmCategory, category_name)
                    threshold_enum = getattr(genai.types.SafetySetting.HarmBlockThreshold, setting['threshold'])
                    safety_settings_list.append(genai.types.SafetySetting(category=category_enum, threshold=threshold_enum))
                else:
                    logger.warning(f"Bo qua safety setting (fallback) voi category khong hop le: {setting['category']}")

        model_for_fc = GenerativeModel(gemini_model_name, tools=AVAILABLE_TOOLS)
        chat_session = model_for_fc.start_chat(history=[])
        thoughts_for_ui = []
        MAX_FUNCTION_CALLS = 500
        num_calls = 0
        current_content_for_send_message: str | list[dict] = full_prompt_for_gemini

        while num_calls < MAX_FUNCTION_CALLS:
            logger.info(f"Generate FGT (FC Loop {num_calls+1}/{MAX_FUNCTION_CALLS}): Sending to Gemini...")
            response = chat_session.send_message(
                content=current_content_for_send_message,
                generation_config=generation_config_obj,
                safety_settings=safety_settings_list
            )
            candidate = response.candidates[0]

            if not candidate.content or not candidate.content.parts:
                 logger.error("Generate FGT (FC): Phan hoi cua AI khong co content hoac parts.")
                 return jsonify({"error": "AI trả về phản hồi không hợp lệ (không có content hoặc parts).", "thoughts": thoughts_for_ui}), 500

            function_call_part = None
            for part_item in candidate.content.parts:
                if hasattr(part_item, 'function_call') and part_item.function_call: 
                    function_call_part = part_item.function_call
                    break
            
            if function_call_part:
                fc = function_call_part
                tool_name = fc.name
                tool_args = dict(fc.args) if fc.args else {}
                current_ts = datetime.now().isoformat()
                logger.info(f"Generate FGT (FC): AI requested tool '{tool_name}' with args: {tool_args}")
                thoughts_for_ui.append({
                    "type": "function_call_request", "tool_name": tool_name,
                    "tool_args": tool_args, "timestamp": current_ts
                })

                tool_response_text = ""
                tool_error_flag = False

                if tool_name == "get_fortigate_data":
                    fgt_command_to_run = tool_args.get("command")
                    if fgt_command_to_run:
                        logger.info(f"Tool '{tool_name}': Executing command '{fgt_command_to_run}'")
                        exec_result = execute_fortigate_commands(fgt_command_to_run, fortigate_config_from_request)
                        if exec_result["error"]:
                            # Dinh dang ro rang hon de AI phan tich loi
                            tool_response_text = f"[LỖI THỰC THI FORTIGATE]: Lệnh '{fgt_command_to_run}' thất bại. Chi tiết: {exec_result['error']}. Output: {exec_result['output']}"
                            tool_error_flag = True
                        else:
                            tool_response_text = exec_result["output"] if exec_result["output"] else "(Lệnh không trả về output)"
                    else:
                        tool_response_text = "Lỗi: Tool 'get_fortigate_data' được gọi nhưng thiếu tham số 'command'."
                        tool_error_flag = True
                else:
                    tool_response_text = f"Lỗi: Tool '{tool_name}' không được backend hỗ trợ."
                    tool_error_flag = True
                
                thoughts_for_ui.append({
                    "type": "function_call_result", "tool_name": tool_name,
                    "result_data": tool_response_text, "is_error": tool_error_flag,
                    "timestamp": datetime.now().isoformat()
                })
                current_content_for_send_message = [{
                    "function_response": {
                        "name": tool_name,
                        "response": {"output": tool_response_text} 
                    }
                }]
            else:
                # Ktra finish_reason bang name hoac so sanh voi enum tu genai.types
                # genai.types.FinishReason.STOP (neu FinishReason van import dc tu genai.types)
                # hoac candidate.finish_reason.name == "STOP"
                finish_reason_name = candidate.finish_reason.name if hasattr(candidate.finish_reason, 'name') else str(candidate.finish_reason)
                if finish_reason_name == "STOP":
                    final_text_response = "".join(part_item.text for part_item in candidate.content.parts if hasattr(part_item, 'text') and part_item.text)
                    logger.info(f"Generate FGT (FC): AI final response (text): {final_text_response[:200]}...")
                    generated_code = extract_code_block(final_text_response, 'fortios', user_input_prompt_str)
                    return jsonify({"code": generated_code, "generated_for_type": "fortios", "thoughts": thoughts_for_ui})
                else:
                    safety_ratings_str = str(getattr(candidate, 'safety_ratings', 'N/A'))
                    error_msg_fc_loop = f"AI không trả về function call hoặc text cuối cùng. Lý do: {finish_reason_name}. Safety: {safety_ratings_str}"
                    logger.error(f"Generate FGT (FC): {error_msg_fc_loop}")
                    return jsonify({"error": error_msg_fc_loop, "thoughts": thoughts_for_ui}), 500
            num_calls += 1

        if num_calls >= MAX_FUNCTION_CALLS:
            logger.error("Generate FGT (FC): Đã vượt quá số lần gọi tool tối đa.")
            return jsonify({"error": "Đã vượt quá số lần gọi tool tối đa.", "thoughts": thoughts_for_ui}), 500
        
        logger.error("Generate FGT (FC): Vong lap Function Calling ket thuc bat thuong.")
        return jsonify({"error": "Xử lý yêu cầu FortiGate thất bại sau nhiều bước.", "thoughts": thoughts_for_ui}), 500

    fortigate_context_str_for_normal_generate = None
    is_fortigate_related_request_normal = (
        target_os_name.lower() == 'fortios' or
        (user_input_prompt_str and ("fortigate" in user_input_prompt_str.lower() or "fortios" in user_input_prompt_str.lower())) or
        file_extension == 'fortios'
    )

    if is_fortigate_related_request_normal and not is_fortios_interactive_generate:
        if not fortigate_config_from_request or \
           not fortigate_config_from_request.get('ipHost') or \
           not fortigate_config_from_request.get('username'):
            logger.warning("Generate (Normal FGT): Thieu info ket noi de lay ctx.")
            fortigate_context_str_for_normal_generate = "Lưu ý: Không thể lấy ngữ cảnh FortiGate tự động do thiếu thông tin kết nối (IP/Host, Username trong Cài đặt)."
        else:
            try:
                fortigate_context_str_for_normal_generate = fetch_and_save_fortigate_context(
                    fortigate_config_from_request,
                    commands_to_fetch=fortigate_selected_context_commands
                )
            except Exception as e_ctx_norm:
                logger.error(f"Generate (Normal FGT): Loi khi lay ngu canh: {e_ctx_norm}", exc_info=True)
                fortigate_context_str_for_normal_generate = f"Lưu ý: Lỗi khi lấy ngữ cảnh: {str(e_ctx_norm)}"

    full_prompt = create_prompt(user_input_prompt_str, backend_os_name, target_os_name, file_type_input, fortigate_context_data=fortigate_context_str_for_normal_generate)
    raw_response = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=False)

    if raw_response and not raw_response.startswith("Lỗi"):
        ext_for_extraction = file_extension
        if target_os_name.lower() == 'fortios' and file_extension in ['txt', 'conf', 'cli', 'log']:
            ext_for_extraction = 'fortios'
        elif file_extension == 'fortios':
             ext_for_extraction = 'fortios'

        generated_code = extract_code_block(raw_response, ext_for_extraction, user_input_for_context=user_input_prompt_str)
        effective_generated_type = file_extension
        if ext_for_extraction == 'fortios':
            effective_generated_type = 'fortios'

        is_likely_raw_text = (generated_code == raw_response) and not generated_code.strip().startswith("```")
        if not generated_code.strip() or is_likely_raw_text:
             logger.error(f"AI ko tra ve khoi ma hop lệ (Normal Gen). Phan hoi tho: {raw_response[:200]}...")
             return jsonify({"error": f"AI không trả về khối mã hợp lệ. Phản hồi: '{raw_response[:50]}...'", "thoughts": []}), 500

        potentially_dangerous = ["rm ", "del ", "format ", "shutdown ", "reboot ", ":(){:|:&};:", "dd if=/dev/zero", "mkfs", "execute formatlogdisk"]
        detected_dangerous = [kw for kw in potentially_dangerous if kw.lower() in generated_code.lower()]
        if detected_dangerous:
            logger.warning(f"Canh bao (Normal Gen): Ma tao ra chua tu khoa nguy hiem: {detected_dangerous}")
        return jsonify({"code": generated_code, "generated_for_type": effective_generated_type, "thoughts": []})

    status_code = 400
    if raw_response and ("Lỗi cấu hình" in raw_response or "Lỗi: Phản hồi bị chặn" in raw_response):
        status_code = 400
    else:
        status_code = 500
    return jsonify({"error": raw_response or "Lỗi không xác định khi sinh mã.", "thoughts": []}), status_code


@api_bp.route('/review', methods=['POST'])
def handle_review():
    logger = current_app.logger
    data = request.get_json()
    code_to_review = data.get('code')
    raw_model_config_from_request = data.get('model_config', {})
    model_config = _normalize_model_config(raw_model_config_from_request)
    file_type = data.get('file_type', 'py')

    if not code_to_review:
        return jsonify({"error": "Không có mã nào để đánh giá."}), 400

    language_extension = file_type.split('.')[-1].lower() if '.' in file_type else file_type.lower()
    if not language_extension: language_extension = 'py'

    full_prompt = create_review_prompt(code_to_review, language_extension)
    review_text = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=True)

    if review_text and not review_text.startswith("Lỗi"):
        return jsonify({"review": review_text})

    status_code = 400
    if review_text and ("Lỗi cấu hình" in review_text or "Lỗi: Phản hồi bị chặn" in review_text):
        status_code = 400
    else:
        status_code = 500
    # FIX: Doi toan tu JS '||' sang Python 'or'
    return jsonify({"error": review_text or "Lỗi không xác định khi đánh giá."}), status_code

@api_bp.route('/execute', methods=['POST'])
def handle_execute():
    logger = current_app.logger
    data = request.get_json()
    code_to_execute = data.get('code')
    run_as_admin = data.get('run_as_admin', False)
    file_type_requested = data.get('file_type', 'py')
    fortigate_config = data.get('fortigate_config')

    if not code_to_execute:
        return jsonify({"error": "Không có mã nào để thực thi."}), 400

    file_extension = file_type_requested.split('.')[-1].lower() if '.' in file_type_requested else file_type_requested.lower()
    if not file_extension or not (file_extension.isalnum() or file_extension == 'fortios'):
        file_extension = 'py'

    if file_extension == 'fortios':
        logger.info(f"Nhan lenh FortiOS CLI (.{file_extension}). Chuan bi thuc thi.")
        if not fortigate_config or not fortigate_config.get('ipHost') or not fortigate_config.get('username'):
            logger.error("Thieu fortigate_config (IP/Host, User) cho lenh FortiOS.")
            return jsonify({
                "message": "Lỗi: Thiếu thông tin kết nối FortiGate (IP/Host, Username). Vui lòng kiểm tra Cài đặt.",
                "output": "", "error": "Thiếu thông tin cấu hình FortiGate.", "return_code": -1,
                "executed_file_type": file_extension, "codeThatFailed": code_to_execute
            }), 400

        fgt_result = execute_fortigate_commands(code_to_execute, fortigate_config)
        response_message = "Gửi lệnh FortiOS CLI thành công." if fgt_result["return_code"] == 0 and not fgt_result["error"] else \
                           "Gửi lệnh FortiOS CLI hoàn tất (có thể có lỗi)."
        if fgt_result["error"] or (fgt_result["output"] and ("command fail" in fgt_result["output"].lower() or "error" in fgt_result["output"].lower())):
             response_message = "Gửi lệnh FortiOS CLI hoàn tất, nhưng có vẻ đã xảy ra lỗi hoặc cảnh báo từ thiết bị."

        return jsonify({
            "message": response_message,
            "output": fgt_result["output"], "error": fgt_result["error"],
            "return_code": fgt_result["return_code"], "executed_file_type": file_extension,
            "codeThatFailed": code_to_execute
        })

    exec_result = execute_local_script(code_to_execute, file_extension, run_as_admin)

    if "error_type" in exec_result:
        status_code = 408 if exec_result["error_type"] == "Timeout" else 500
        return jsonify({
            "error": exec_result["message"], "output": exec_result["output"],
            "error_detail": exec_result["error_detail"], "return_code": exec_result["return_code"],
            "warning": exec_result.get("warning"), "codeThatFailed": code_to_execute
        }), status_code

    return jsonify(exec_result)


@api_bp.route('/debug', methods=['POST'])
def handle_debug():
    logger = current_app.logger
    data = request.get_json()
    original_prompt = data.get('prompt', '(Không có prompt gốc)')
    failed_code = data.get('code')
    stdout = data.get('stdout', '')
    stderr = data.get('stderr', '')
    raw_model_config_from_request = data.get('model_config', {})
    model_config = _normalize_model_config(raw_model_config_from_request)
    file_type = data.get('file_type', 'py')
    fortigate_config_for_context = data.get('fortigate_config_for_context')
    fortigate_selected_commands = data.get('fortigate_selected_context_commands', DEFAULT_FORTIGATE_CONTEXT_COMMANDS)
    if not fortigate_selected_commands:
        fortigate_selected_commands = DEFAULT_FORTIGATE_CONTEXT_COMMANDS

    if not failed_code:
        return jsonify({"error": "Thiếu mã lỗi để gỡ rối."}), 400

    language_extension = file_type.split('.')[-1].lower() if '.' in file_type else file_type.lower()
    if not language_extension: language_extension = 'py'

    fortigate_context_str_debug = None
    is_fortigate_debug_request = (
        language_extension.lower() == 'fortios' or
        (original_prompt and ("fortigate" in original_prompt.lower() or "fortios" in original_prompt.lower()))
    )

    if is_fortigate_debug_request:
        if not fortigate_config_for_context or \
           not fortigate_config_for_context.get('ipHost') or \
           not fortigate_config_for_context.get('username'):
            logger.warning("Debug FGT: Thieu info ket noi de lay ngu canh.")
            fortigate_context_str_debug = "Lưu ý: Không thể lấy ngữ cảnh FortiGate tự động do thiếu thông tin kết nối (IP/Host, Username trong Cài đặt) để lấy ngữ cảnh mới."
        else:
            try:
                fortigate_context_str_debug = fetch_and_save_fortigate_context(
                    fortigate_config_for_context,
                    commands_to_fetch=fortigate_selected_commands
                )
            except Exception as e_ctx_dbg:
                logger.error(f"Debug FGT: Loi khi lay ngu canh: {e_ctx_dbg}", exc_info=True)
                fortigate_context_str_debug = f"Lưu ý: Lỗi khi lấy ngữ cảnh cho debug: {str(e_ctx_dbg)}"

    full_prompt = create_debug_prompt(original_prompt, failed_code, stdout, stderr, language_extension, fortigate_context_data=fortigate_context_str_debug)
    raw_response = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=True)

    if raw_response and not raw_response.startswith("Lỗi"):
        explanation_part = raw_response
        corrected_code = None
        suggested_package = None

        if language_extension == 'py':
            install_match = re.search(r"```bash\s*pip install\s+([\w\-==\.\+\[\]]+)\s*```", explanation_part, re.IGNORECASE | re.DOTALL)
            if install_match:
                suggested_package = install_match.group(1).strip()
                explanation_part = explanation_part.replace(install_match.group(0), "").strip()

        last_code_block_match = None
        debug_code_block_tags_priority = [language_extension]
        if language_extension == 'py': debug_code_block_tags_priority.append('python')
        if language_extension == 'sh': debug_code_block_tags_priority.extend(['bash', 'shell'])
        if language_extension == 'bat': debug_code_block_tags_priority.append('batch')
        if language_extension == 'ps1': debug_code_block_tags_priority.append('powershell')
        if language_extension == 'fortios': debug_code_block_tags_priority.extend(['fortios', 'cli', 'text'])
        if 'code' not in debug_code_block_tags_priority: debug_code_block_tags_priority.append('code')

        for lang_tag in reversed(debug_code_block_tags_priority):
            pattern_str = r"```" + (re.escape(lang_tag) if lang_tag != 'code' else "") + r"(?:[^\S\n].*?)?\s*\n([\s\S]*?)\n```"
            try:
                matches = list(re.finditer(pattern_str, explanation_part, re.IGNORECASE | re.MULTILINE))
                if matches:
                    last_code_block_match = matches[-1]
                    break
            except re.error: pass
        
        if last_code_block_match:
            corrected_code = last_code_block_match.group(1).strip()
            explanation_part = explanation_part[:last_code_block_match.start()].strip()
            if not explanation_part:
                 explanation_part = f"(AI chỉ trả về mã {get_language_name(language_extension)} đã sửa.)"
        
        explanation_part = re.sub(r"^(Phân tích và đề xuất:|Giải thích và đề xuất:|Phân tích:|Giải thích:)\s*", "", explanation_part, flags=re.IGNORECASE | re.MULTILINE).strip()
        if not explanation_part and not corrected_code and not suggested_package:
            explanation_part = "(Không có giải thích, mã sửa, hoặc đề xuất package từ AI.)"

        return jsonify({
            "explanation": explanation_part,
            "corrected_code": corrected_code,
            "suggested_package": suggested_package,
            "original_language": language_extension
        })

    status_code = 400
    if raw_response and ("Lỗi cấu hình" in raw_response or "Lỗi: Phản hồi bị chặn" in raw_response):
        status_code = 400
    else:
        status_code = 500
    return jsonify({"error": raw_response or "Lỗi không xác định khi gỡ lỗi."}), status_code

@api_bp.route('/install_package', methods=['POST'])
def handle_install_package():
    logger = current_app.logger
    data = request.get_json()
    package_name = data.get('package_name')

    if not package_name:
        return jsonify({"error": "Thiếu tên package để cài đặt."}), 400

    if not re.fullmatch(r"^[a-zA-Z0-9\-_==\.\+\[\]\s]+$", package_name):
        logger.warning(f"Ten package ko hop le bi tu choi: {package_name}")
        return jsonify({"success": False, "error": f"Tên package không hợp lệ: {package_name}"}), 400

    logger.info(f"--- Chuan bi cai dat package: {package_name} ---")
    try:
        pip_command_parts = [sys.executable, '-m', 'pip', 'install'] + shlex.split(package_name)
        command = [part for part in pip_command_parts if part]
    except Exception as parse_err:
        logger.error(f"Ko the phan tich ten package '{package_name}': {parse_err}")
        return jsonify({"success": False, "error": f"Tên package không hợp lệ: {package_name}"}), 400

    try:
        process_env = os.environ.copy()
        process_env["PYTHONIOENCODING"] = "utf-8"
        result = subprocess.run(
            command, capture_output=True, encoding='utf-8', errors='replace',
            timeout=120, check=False, env=process_env, text=True
        )
        output = result.stdout
        error_output = result.stderr
        return_code = result.returncode

        if output: logger.info(f"Pip Output:\n{output}")
        if error_output: logger.info(f"Pip Error Output:\n{error_output}")

        if return_code == 0:
            return jsonify({ "success": True, "message": f"Cài đặt '{package_name}' thành công.", "output": output, "error": error_output })
        else:
            detailed_error = error_output.strip() if error_output.strip() else f"Lệnh Pip thất bại với mã trả về {return_code}."
            return jsonify({ "success": False, "message": f"Cài đặt '{package_name}' thất bại.", "output": output, "error": detailed_error }), 500

    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": f"Timeout khi cài đặt '{package_name}'.", "output": "", "error_detail": "Timeout"}), 408
    except FileNotFoundError:
         return jsonify({"success": False, "error": "Lỗi hệ thống: Không tìm thấy Python hoặc Pip.", "output": "", "error_detail": "FileNotFoundError"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Lỗi hệ thống khi cài đặt: {e}", "output": "", "error_detail": str(e)}), 500

@api_bp.route('/explain', methods=['POST'])
def handle_explain():
    logger = current_app.logger
    data = request.get_json()
    content_to_explain_input = data.get('content')
    context = data.get('context', 'unknown')
    raw_model_config_from_request = data.get('model_config', {})
    model_config = _normalize_model_config(raw_model_config_from_request)
    file_type_for_code_context = data.get('file_type')

    if not content_to_explain_input:
        return jsonify({"error": "Không có nội dung để giải thích."}), 400

    content_to_explain_str = content_to_explain_input
    if isinstance(content_to_explain_input, (dict, list)):
         try: content_to_explain_str = json.dumps(content_to_explain_input, ensure_ascii=False, indent=2)
         except Exception: content_to_explain_str = str(content_to_explain_input)
    else: content_to_explain_str = str(content_to_explain_input)

    language_for_prompt = None
    if context == 'code' and file_type_for_code_context:
        language_for_prompt = file_type_for_code_context.split('.')[-1].lower() if '.' in file_type_for_code_context else file_type_for_code_context.lower()
        if not language_for_prompt: language_for_prompt = 'txt'

    full_prompt = create_explain_prompt(content_to_explain_str, context, language=language_for_prompt)
    explanation_text = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=True)

    if explanation_text and not explanation_text.startswith("Lỗi"):
        explanation_text = re.sub(r"^(Đây là giải thích về.*?:\s*|Giải thích về.*?:\s*)", "", explanation_text, flags=re.IGNORECASE | re.MULTILINE).strip()
        return jsonify({"explanation": explanation_text})

    status_code = 400
    if explanation_text and ("Lỗi cấu hình" in explanation_text or "Lỗi: Phản hồi bị chặn" in explanation_text):
        status_code = 400
    else: status_code = 500
    # FIX: Doi toan tu JS '||' sang Python 'or'
    return jsonify({"error": explanation_text or "Lỗi không xác định khi giải thích."}), status_code

@api_bp.route('/fortigate_chat', methods=['POST'])
def handle_fortigate_chat():
    logger = current_app.logger
    data = request.get_json()
    user_prompt_str = data.get('prompt')
    fortigate_config_from_request = data.get('fortigate_config')
    raw_model_config_from_request = data.get('model_config', {})
    model_config = _normalize_model_config(raw_model_config_from_request)
    conversation_history_context_str = data.get('conversation_history_for_chat_context', "(Không có lịch sử FortiOS)")
    fortigate_selected_context_commands = data.get('fortigate_selected_context_commands', DEFAULT_FORTIGATE_CONTEXT_COMMANDS)
    if not fortigate_selected_context_commands:
        fortigate_selected_context_commands = DEFAULT_FORTIGATE_CONTEXT_COMMANDS

    if not user_prompt_str:
        return jsonify({"error": "Vui lòng nhập yêu cầu.", "thoughts": []}), 400

    logger.info("FortiGate Chat: Bat dau xu ly voi Function Calling.")
    if not fortigate_config_from_request or not fortigate_config_from_request.get('ipHost') or not fortigate_config_from_request.get('username'):
        logger.warning("FortiGate Chat (FC): Thieu IP/Host hoac Username FortiGate.")
        # return jsonify({"error": "Lỗi: Thiếu IP/Host hoặc Username cho FortiGate trong Cài đặt. AI không thể lấy thông tin.", "thoughts": []}), 400

    initial_fortigate_context_str = "Thông tin ngữ cảnh FortiGate không thể lấy do thiếu cấu hình hoặc lỗi kết nối."
    if fortigate_config_from_request and fortigate_config_from_request.get('ipHost') and fortigate_config_from_request.get('username'):
        try:
            initial_fortigate_context_str = fetch_and_save_fortigate_context(
                fortigate_config_from_request,
                commands_to_fetch=fortigate_selected_context_commands
            )
        except Exception as e_ctx_chat:
            logger.error(f"FGT Chat (FC): Loi khi lay ctx ban dau: {e_ctx_chat}")
            initial_fortigate_context_str = f"Lưu ý: Lỗi khi lấy ngữ cảnh FortiGate ban đầu: {str(e_ctx_chat)}"

    HISTORY_LIMIT_CHAT = 8000
    FGT_CTX_LIMIT_CHAT = 6000

    system_instruction_for_chat = f"""Bạn là một trợ lý AI chuyên gia về FortiGate.
Nhiệm vụ của bạn là trả lời câu hỏi của người dùng dựa trên kiến thức của bạn, thông tin ngữ cảnh FortiGate được cung cấp, và lịch sử hội thoại.
Nếu bạn cần thêm thông tin cấu hình hoặc trạng thái hiện tại của FortiGate để trả lời chính xác, hãy sử dụng tool `get_fortigate_data` để chạy các lệnh 'show', 'get', hoặc 'diagnose'.
KHÔNG tạo ra các khối mã lệnh mới trừ khi người dùng YÊU CẦU RÕ RÀNG trong câu hỏi hiện tại của họ là "tạo lệnh", "viết script", "generate config".
Nếu người dùng chỉ hỏi thông tin, giải thích, hoặc gợi ý sửa lỗi, hãy cung cấp câu trả lời dưới dạng văn bản.
Sử dụng Markdown cho câu trả lời của bạn. Bắt đầu trực tiếp bằng câu trả lời, không thêm lời dẫn.

Ngữ cảnh FortiGate hiện tại:
<fortigate_config_context_start>
{initial_fortigate_context_str[:FGT_CTX_LIMIT_CHAT]}
</fortigate_config_context_start>

Lịch sử hội thoại gần đây (nếu có):
<conversation_history_start>
{conversation_history_context_str[:HISTORY_LIMIT_CHAT]}
</conversation_history_start>

Yêu cầu hiện tại của người dùng: "{user_prompt_str}"
"""
    # Huong dan AI tu retry khi gap loi tool trong chat mode (nghe loi ma thu lai ngay)
    system_instruction_for_chat += "\n**QUAN TRỌNG:** Nếu một lệnh thực thi qua tool `get_fortigate_data` trả về lỗi, bạn phải **NGAY LẬP TỨC** phân tích lỗi đó và thử lại tool `get_fortigate_data` với lệnh đã sửa đổi hoặc điều chỉnh cách tiếp cận. **KHÔNG** giải thích lỗi hoặc thông báo kế hoạch của bạn cho đến khi bạn đã thử lại tool và có kết quả mới. Mục tiêu là hoàn thành yêu cầu bằng cách thực thi lệnh tool thành công hoặc cung cấp câu trả lời hữu ích dựa trên thông tin tool thu được."


    genai_api_key_to_use_chat = model_config.get('api_key') or current_app.config.get('GOOGLE_API_KEY')
    if not genai_api_key_to_use_chat:
        return jsonify({"error": "API Key của Google chưa được cấu hình.", "thoughts": []}), 500
    try:
        genai.configure(api_key=genai_api_key_to_use_chat)
        logger.info(f"FGT Chat (FC): Da (lai) cau hinh GenAI voi key {'tu UI' if model_config.get('api_key') else 'tu .env'}.")
    except Exception as e_cfg_genai_chat:
        logger.error(f"Loi cau hinh GenAI (Chat FC): {e_cfg_genai_chat}")
        return jsonify({"error": f"Lỗi cấu hình thư viện Google GenAI: {e_cfg_genai_chat}", "thoughts": []}), 500

    gemini_model_name_chat = model_config.get('model_name', 'gemini-1.5-flash')
    # Su dung genai.types cho GenerationConfig, SafetySetting, HarmCategory
    try:
        generation_config_obj_chat = GenerationConfig(
            temperature=float(model_config.get('temperature', 0.7)),
            top_p=float(model_config.get('top_p', 0.95)),
            top_k=int(model_config.get('top_k', 40))
        )
        safety_setting_key_chat = model_config.get('safety_setting', 'BLOCK_MEDIUM_AND_ABOVE')
        safety_settings_config_chat = current_app.config.get('SAFETY_SETTINGS_MAP', {}).get(safety_setting_key_chat, [])
        safety_settings_list_chat = []
        for setting in safety_settings_config_chat:
            category_name_chat = setting['category'].replace("HARM_CATEGORY_", "")
            if hasattr(genai.types.HarmCategory, category_name_chat): # Ktra HarmCategory tu genai.types
                category_enum_chat = getattr(genai.types.HarmCategory, category_name_chat)
                threshold_enum_chat = getattr(genai.types.SafetySetting.HarmBlockThreshold, setting['threshold'])
                safety_settings_list_chat.append(genai.types.SafetySetting(category=category_enum_chat, threshold=threshold_enum_chat))
            else:
                logger.warning(f"Bo qua safety setting (Chat) voi category khong hop le: {setting['category']}")
    except AttributeError as e_types_attr_chat:
        logger.error(f"Loi AttributeError khi truy cap GenConfig/Safety/HarmCategory (Chat) tu google.generativeai.types: {e_types_attr_chat}. Thu import truc tiep tu genai.types")
        generation_config_obj_chat = genai.types.GenerationConfig(
            temperature=float(model_config.get('temperature', 0.7)),
            top_p=float(model_config.get('top_p', 0.95)),
            top_k=int(model_config.get('top_k', 40))
        )
        safety_setting_key_chat = model_config.get('safety_setting', 'BLOCK_MEDIUM_AND_ABOVE')
        safety_settings_config_chat = current_app.config.get('SAFETY_SETTINGS_MAP', {}).get(safety_setting_key_chat, [])
        safety_settings_list_chat = []
        for setting in safety_settings_config_chat:
            category_name_chat = setting['category'].replace("HARM_CATEGORY_", "")
            if hasattr(genai.types.HarmCategory, category_name_chat):
                category_enum_chat = getattr(genai.types.HarmCategory, category_name_chat)
                threshold_enum_chat = getattr(genai.types.SafetySetting.HarmBlockThreshold, setting['threshold'])
                safety_settings_list_chat.append(genai.types.SafetySetting(category=category_enum_chat, threshold=threshold_enum_chat))
            else:
                logger.warning(f"Bo qua safety setting (Chat fallback) voi category khong hop le: {setting['category']}")

    model_for_chat_fc = GenerativeModel(gemini_model_name_chat, tools=AVAILABLE_TOOLS)
    chat_session_fc = model_for_chat_fc.start_chat(history=[])
    thoughts_for_ui_chat = []
    MAX_FC_CHAT = 500
    num_calls_chat = 0
    current_content_for_send_message_chat: str | list[dict] = system_instruction_for_chat


    while num_calls_chat < MAX_FC_CHAT:
        logger.info(f"FGT Chat (FC Loop {num_calls_chat+1}/{MAX_FC_CHAT}): Sending to Gemini...")
        response_chat = chat_session_fc.send_message(
            content=current_content_for_send_message_chat,
            generation_config=generation_config_obj_chat,
            safety_settings=safety_settings_list_chat
        )
        candidate_chat = response_chat.candidates[0]

        if not candidate_chat.content or not candidate_chat.content.parts:
            logger.error("FGT Chat (FC): Phan hoi cua AI khong co content hoac parts.")
            return jsonify({"error": "AI trả về phản hồi không hợp lệ (không có content hoặc parts).", "thoughts": thoughts_for_ui_chat}), 500

        function_call_part_chat = None
        for part_item_chat in candidate_chat.content.parts:
            if hasattr(part_item_chat, 'function_call') and part_item_chat.function_call: 
                function_call_part_chat = part_item_chat.function_call
                break

        if function_call_part_chat:
            fc_chat = function_call_part_chat
            tool_name_chat = fc_chat.name
            tool_args_chat = dict(fc_chat.args) if fc_chat.args else {}
            current_ts_chat = datetime.now().isoformat()
            logger.info(f"FGT Chat (FC): AI requested tool '{tool_name_chat}' with args: {tool_args_chat}")
            thoughts_for_ui_chat.append({
                "type": "function_call_request", "tool_name": tool_name_chat,
                "tool_args": tool_args_chat, "timestamp": current_ts_chat
            })

            tool_response_text_chat = ""
            tool_error_flag_chat = False

            if tool_name_chat == "get_fortigate_data":
                fgt_cmd_chat = tool_args_chat.get("command")
                if fgt_cmd_chat:
                    if not fortigate_config_from_request or not fortigate_config_from_request.get('ipHost') or not fortigate_config_from_request.get('username'):
                        tool_response_text_chat = "Lỗi: Backend không thể thực thi lệnh FortiGate vì thiếu thông tin IP/Host hoặc Username."
                        tool_error_flag_chat = True
                    else:
                        exec_res_chat = execute_fortigate_commands(fgt_cmd_chat, fortigate_config_from_request)
                        if exec_res_chat["error"]:
                            # Dinh dang ro rang hon de AI phan tich loi
                            tool_response_text_chat = f"[LỖI THỰC THI FORTIGATE]: Lệnh '{fgt_cmd_chat}' thất bại. Chi tiết: {exec_res_chat['error']}. Output: {exec_res_chat['output']}"
                            tool_error_flag_chat = True
                        else:
                            tool_response_text_chat = exec_res_chat["output"] if exec_res_chat["output"] else "(Lệnh không có output)"
                else:
                    tool_response_text_chat = "Lỗi: Tool 'get_fortigate_data' thiếu 'command'."
                    tool_error_flag_chat = True
            else:
                tool_response_text_chat = f"Lỗi: Tool '{tool_name_chat}' không được backend hỗ trợ."
                tool_error_flag_chat = True
            
            thoughts_for_ui_chat.append({
                "type": "function_call_result", "tool_name": tool_name_chat,
                "result_data": tool_response_text_chat, "is_error": tool_error_flag_chat,
                "timestamp": datetime.now().isoformat()
            })
            current_content_for_send_message_chat = [{
                "function_response": {
                    "name": tool_name_chat,
                    "response": {"output": tool_response_text_chat}
                }
            }]
        else:
            finish_reason_name_chat = candidate_chat.finish_reason.name if hasattr(candidate_chat.finish_reason, 'name') else str(candidate_chat.finish_reason)
            if finish_reason_name_chat == "STOP":
                final_text_chat = "".join(part_item_chat.text for part_item_chat in candidate_chat.content.parts if hasattr(part_item_chat, 'text') and part_item_chat.text)
                logger.info(f"FGT Chat (FC): AI final response (text): {final_text_chat[:200]}...")
                cleaned_response_chat = re.sub(r"^\s*\[(thinking|internal|process\w*)\].*$\n?", "", final_text_chat, flags=re.MULTILINE).strip()
                return jsonify({"chat_response": cleaned_response_chat, "thoughts": thoughts_for_ui_chat})
            else:
                safety_ratings_str_chat = str(getattr(candidate_chat, 'safety_ratings', 'N/A'))
                error_msg_fc_loop_chat = f"AI (Chat FC) không trả về FC/text. Lý do: {finish_reason_name_chat}. Safety: {safety_ratings_str_chat}"
                logger.error(f"FGT Chat (FC): {error_msg_fc_loop_chat}")
                return jsonify({"error": error_msg_fc_loop_chat, "thoughts": thoughts_for_ui_chat}), 500
        num_calls_chat += 1

    if num_calls_chat >= MAX_FC_CHAT:
        logger.error("FGT Chat (FC): Đã vượt quá số lần gọi tool tối đa.")
        return jsonify({"error": "Đã vượt quá số lần gọi tool tối đa cho chat.", "thoughts": thoughts_for_ui_chat}), 500
    
    logger.error("FGT Chat (FC): Vong lap Function Calling ket thuc bat thuong.")
    return jsonify({"error": "Xử lý yêu cầu chat FortiGate thất bại.", "thoughts": thoughts_for_ui_chat}), 500

@api_bp.route('/backend_logs', methods=['GET'])
def get_backend_logs():
    logger = current_app.logger
    log_file_path_from_app = None

    if hasattr(logger, 'handlers'):
        for handler in logger.handlers:
            if isinstance(handler, logging.handlers.RotatingFileHandler) or isinstance(handler, logging.FileHandler):
                if hasattr(handler, 'baseFilename') and handler.baseFilename: # Check if baseFilename is not None or empty
                    log_file_path_from_app = handler.baseFilename
                    break
    
    if not log_file_path_from_app:
        project_root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        logs_dir_path = os.path.join(project_root_dir, 'logs')
        log_file_path_from_app = os.path.join(logs_dir_path, 'gemini_executor.log')
        logger.info(f"Log path from handler not found or invalid, falling back to: {log_file_path_from_app}")

    if not os.path.exists(log_file_path_from_app):
        logger.error(f"Backend log file not found at: {log_file_path_from_app}")
        return jsonify({"logs": [f"Log file '{os.path.basename(log_file_path_from_app)}' not found."], "error": "Log file not found"}), 404

    try:
        lines_to_fetch = int(request.args.get('lines', 50)) 
        if lines_to_fetch <= 0 or lines_to_fetch > 500: 
            lines_to_fetch = 50
            
        with open(log_file_path_from_app, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
            log_lines = [line.strip() for line in all_lines[-lines_to_fetch:]]
        
        return jsonify({"logs": log_lines})
    except Exception as e:
        logger.error(f"Error reading backend log file '{log_file_path_from_app}': {e}", exc_info=True)
        return jsonify({"logs": [f"Error reading log file: {str(e)}"], "error": str(e)}), 500