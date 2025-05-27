# backend/routes.py
import os
import sys
import subprocess
import shlex
import re
import json

from flask import request, jsonify, Blueprint, current_app # Them current_app
from .helpers import get_os_name, get_language_name
from .prompt_utils import (
    create_prompt, create_review_prompt,
    create_debug_prompt, create_explain_prompt
)
from .gemini_utils import generate_response_from_gemini
from .execution_utils import (
    extract_code_block, execute_fortigate_commands,
    execute_local_script, fetch_and_save_fortigate_context # Them fetch
)

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/generate', methods=['POST'])
def handle_generate():
    logger = current_app.logger
    data = request.get_json()
    user_input = data.get('prompt')
    model_config = data.get('model_config', {})
    target_os_input = data.get('target_os', 'auto')
    file_type_input = data.get('file_type', 'py')
    # Lay cfg FGT tu request de lay ctx
    fortigate_config_from_request = data.get('fortigate_config')


    if not user_input:
        return jsonify({"error": "Vui lòng nhập yêu cầu."}), 400

    backend_os_name = get_os_name()
    target_os_name = target_os_input if target_os_input.lower() == 'fortios' else \
                     (backend_os_name if target_os_input == 'auto' else target_os_input)

    if '.' in file_type_input:
        file_extension = file_type_input.split('.')[-1].lower()
    else:
        file_extension = file_type_input.lower()

    if not file_extension or not (file_extension.isalnum() or file_extension == 'fortios'):
        file_extension = 'py' # Mac dinh

    # --- Lay ngu canh FortiGate neu can ---
    fortigate_context_str = None
    is_fortigate_related_request = (
        target_os_name.lower() == 'fortios' or
        (user_input and ("fortigate" in user_input.lower() or "fortios" in user_input.lower())) or
        file_extension == 'fortios'
    )

    if is_fortigate_related_request:
        if not fortigate_config_from_request or \
           not fortigate_config_from_request.get('ipHost') or \
           not fortigate_config_from_request.get('username'):
            logger.warning("Y/c FortiGate nhung thieu info ket noi de lay ctx.")
            fortigate_context_str = "Lưu ý: Không thể lấy ngữ cảnh FortiGate tự động do thiếu thông tin kết nối (IP/Host, Username trong Cài đặt)."
        else:
            try:
                logger.info("Y/c FortiGate: Dang lay thong tin ngu canh...")
                fortigate_context_str = fetch_and_save_fortigate_context(fortigate_config_from_request)
                logger.info("Da lay xong thong tin ngu canh FortiGate.")
            except Exception as e:
                logger.error(f"Loi khi lay ngu canh FortiGate: {e}", exc_info=True)
                fortigate_context_str = f"Lưu ý: Xảy ra lỗi khi cố gắng lấy thông tin ngữ cảnh từ FortiGate: {str(e)}"
    # --- Ket thuc lay ngu canh ---

    full_prompt = create_prompt(user_input, backend_os_name, target_os_name, file_type_input, fortigate_context_data=fortigate_context_str)
    raw_response = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=False)

    logger.info("-" * 20 + " RAW GEMINI RESPONSE (Generate) " + "-" * 20)
    logger.info(raw_response[:1000]) # Log 1 phan
    logger.info("-" * 60)

    if raw_response and not raw_response.startswith("Lỗi"):
        ext_for_extraction = file_extension
        if target_os_name.lower() == 'fortios' and file_extension in ['txt', 'conf', 'cli', 'log']:
            ext_for_extraction = 'fortios'
        elif file_extension == 'fortios':
             ext_for_extraction = 'fortios'

        generated_code = extract_code_block(raw_response, ext_for_extraction, user_input_for_context=user_input)
        effective_generated_type = file_extension
        if ext_for_extraction == 'fortios':
            effective_generated_type = 'fortios'

        is_likely_raw_text = (generated_code == raw_response) and not generated_code.strip().startswith("```")
        if not generated_code.strip() or is_likely_raw_text:
             logger.error(f"AI ko tra ve khoi ma hop le. Phan hoi tho: {raw_response[:200]}...")
             return jsonify({"error": f"AI không trả về khối mã hợp lệ. Phản hồi: '{raw_response[:50]}...'"}), 500

        potentially_dangerous = ["rm ", "del ", "format ", "shutdown ", "reboot ", ":(){:|:&};:", "dd if=/dev/zero", "mkfs"]
        detected_dangerous = [kw for kw in potentially_dangerous if kw in generated_code.lower()]
        if detected_dangerous:
            logger.warning(f"Canh bao: Ma tao ra chua tu khoa nguy hiem: {detected_dangerous}")
        return jsonify({"code": generated_code, "generated_for_type": effective_generated_type})

    status_code = 400
    if raw_response and ("Lỗi cấu hình" in raw_response or "Lỗi: Phản hồi bị chặn" in raw_response):
        status_code = 400
    else:
        status_code = 500
    return jsonify({"error": raw_response or "Lỗi không xác định khi sinh mã."}), status_code

@api_bp.route('/review', methods=['POST'])
def handle_review():
    logger = current_app.logger
    data = request.get_json()
    code_to_review = data.get('code')
    model_config = data.get('model_config', {})
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
        if not fortigate_config:
            logger.error("Thieu fortigate_config cho lenh FortiOS.")
            return jsonify({
                "message": "Lỗi: Thiếu thông tin cấu hình FortiGate.",
                "output": "", "error": "Thiếu fortigate_config.", "return_code": -1,
                "executed_file_type": file_extension, "codeThatFailed": code_to_execute
            }), 400

        fgt_result = execute_fortigate_commands(code_to_execute, fortigate_config)
        response_message = "Gửi lệnh FortiOS CLI thành công." if fgt_result["return_code"] == 0 and not fgt_result["error"] else \
                           "Gửi lệnh FortiOS CLI hoàn tất (có thể có lỗi)."
        return jsonify({
            "message": response_message,
            "output": fgt_result["output"], "error": fgt_result["error"],
            "return_code": fgt_result["return_code"], "executed_file_type": file_extension,
            "codeThatFailed": code_to_execute # kem theo code loi
        })

    # Script execution
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
    model_config = data.get('model_config', {})
    file_type = data.get('file_type', 'py')
    # Lay FGT config tu UI neu co, de lay lai ctx cho debug
    fortigate_config_for_context = data.get('fortigate_config_for_context')


    if not failed_code:
        return jsonify({"error": "Thiếu mã lỗi để gỡ rối."}), 400

    language_extension = file_type.split('.')[-1].lower() if '.' in file_type else file_type.lower()
    if not language_extension: language_extension = 'py'

    # --- Lay ngu canh FortiGate neu can cho debug ---
    fortigate_context_str_debug = None
    is_fortigate_debug_request = (
        language_extension.lower() == 'fortios' or
        (original_prompt and ("fortigate" in original_prompt.lower() or "fortios" in original_prompt.lower()))
    )

    if is_fortigate_debug_request:
        if not fortigate_config_for_context or \
           not fortigate_config_for_context.get('ipHost') or \
           not fortigate_config_for_context.get('username'):
            logger.warning("Debug FortiGate: Thieu thong tin ket noi de lay ngu canh (fortigate_config_for_context).")
            fortigate_context_str_debug = "Lưu ý: Không thể lấy ngữ cảnh FortiGate tự động do thiếu thông tin kết nối (IP/Host, Username trong Cài đặt) để lấy ngữ cảnh mới."
        else:
            try:
                logger.info("Debug FortiGate: Dang lay thong tin ngu canh...")
                fortigate_context_str_debug = fetch_and_save_fortigate_context(fortigate_config_for_context)
                logger.info("Da lay xong thong tin ngu canh FortiGate cho debug.")
            except Exception as e:
                logger.error(f"Loi khi lay ngu canh FortiGate cho debug: {e}", exc_info=True)
                fortigate_context_str_debug = f"Lưu ý: Xảy ra lỗi khi cố gắng lấy thông tin ngữ cảnh từ FortiGate cho debug: {str(e)}"
    # --- Ket thuc lay ngu canh debug ---

    full_prompt = create_debug_prompt(original_prompt, failed_code, stdout, stderr, language_extension, fortigate_context_data=fortigate_context_str_debug)
    raw_response = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=True)

    if raw_response and not raw_response.startswith("Lỗi"):
        explanation_part = raw_response
        corrected_code = None
        suggested_package = None

        if language_extension == 'py':
            install_match = re.search(r"```bash\s*pip install\s+([\w\-==\.\+\[\]]+)\s*```", explanation_part, re.IGNORECASE)
            if install_match:
                suggested_package = install_match.group(1).strip()
                logger.info(f"Debug (Python): De xuat package: {suggested_package}")
                explanation_part = explanation_part[:install_match.start()].strip() + explanation_part[install_match.end():].strip()

        last_code_block_match = None
        debug_code_block_tag = language_extension if language_extension.isalnum() else 'code'
        tags_to_try = [debug_code_block_tag]
        if language_extension == 'py': tags_to_try.append('python')
        if language_extension == 'sh': tags_to_try.extend(['bash', 'shell'])
        if language_extension == 'bat': tags_to_try.append('batch')
        if language_extension == 'ps1': tags_to_try.append('powershell')
        if language_extension == 'fortios': tags_to_try.extend(['fortios', 'cli', 'text'])

        unique_debug_tags = list(dict.fromkeys(tags_to_try + ['code']))


        for lang_tag in unique_debug_tags:
            pattern_strict = r"```" + re.escape(lang_tag) + r"(?:[^\S\n].*?)?\s*\n([\s\S]*?)\n```"
            pattern_flexible = r"```" + re.escape(lang_tag) + r"(?:[^\S\n].*?)?\s*([\s\S]*?)\s*```"
            if lang_tag == 'code': # fallback neu tag ngon ngu ko dung
                 pattern_strict = r"```\s*\n([\s\S]*?)\n```"
                 pattern_flexible = r"```\s*([\s\S]*?)\s*```"

            for p_str in [pattern_strict, pattern_flexible]:
                try:
                    matches = list(re.finditer(p_str, explanation_part, re.IGNORECASE | re.MULTILINE))
                    if matches:
                        last_code_block_match = matches[-1]
                        logger.info(f"Debug: Tim thay code sua loi voi tag '{lang_tag}'.")
                        break
                except re.error as re_err_debug:
                    logger.error(f"Loi Regex debug code sua voi pattern '{p_str}' tag '{lang_tag}': {re_err_debug}")
            if last_code_block_match: break

        if last_code_block_match:
            start_idx = last_code_block_match.start()
            potential_explanation = explanation_part[:start_idx].strip()
            if potential_explanation:
                 explanation_part = potential_explanation
            else: # Neu AI chi tra ve code, ko co giai thich
                 explanation_part = f"(AI chỉ trả về code {get_language_name(language_extension)} đã sửa, không có giải thích)"
            corrected_code = last_code_block_match.group(1).strip()

        explanation_part = re.sub(r"^(Phân tích và đề xuất:|Giải thích và đề xuất:|Phân tích:|Giải thích:)\s*", "", explanation_part, flags=re.IGNORECASE | re.MULTILINE).strip()
        return jsonify({
            "explanation": explanation_part if explanation_part else "(Không có giải thích)",
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

    if not re.fullmatch(r"^[a-zA-Z0-9\-_==\.\+\[\]]+$", package_name.replace('[','').replace(']','')): # Don gian hoa check
        logger.warning(f"Ten package ko hop le bi tu choi: {package_name}")
        return jsonify({"success": False, "error": f"Tên package không hợp lệ: {package_name}"}), 400

    logger.info(f"--- Chuan bi cai dat package: {package_name} ---")
    try:
        pip_command_parts = [sys.executable, '-m', 'pip', 'install'] + shlex.split(package_name)
        command = [part for part in pip_command_parts if part] # Loai bo phan tu rong neu co
    except Exception as parse_err:
        logger.error(f"Ko the phan tich ten package: {package_name} - {parse_err}")
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

        logger.info(f"--- Ket qua cai dat (Ma tra ve: {return_code}) ---")
        if output: logger.info(f"Output:\n{output}")
        if error_output: logger.info(f"Loi Output:\n{error_output}")

        if return_code == 0:
            return jsonify({ "success": True, "message": f"Cài đặt '{package_name}' thành công.", "output": output, "error": error_output })

        detailed_error = error_output.strip().split('\n')[-1] if error_output.strip() else f"Lệnh Pip thất bại với mã trả về {return_code}."
        return jsonify({ "success": False, "message": f"Cài đặt '{package_name}' thất bại.", "output": output, "error": detailed_error }), 500

    except subprocess.TimeoutExpired:
        logger.error(f"Loi: Cai dat package '{package_name}' qua thoi gian (120s).")
        return jsonify({"success": False, "error": f"Timeout khi cài đặt '{package_name}'.", "output": "", "error_detail": "Timeout"}), 408
    except FileNotFoundError:
         logger.error(f"Loi: Khong tim thay '{sys.executable}' hoac pip.")
         return jsonify({"success": False, "error": "Lỗi hệ thống: Không tìm thấy Python hoặc Pip.", "output": "", "error_detail": "FileNotFoundError"}), 500
    except Exception as e:
        logger.error(f"Loi nghiem trong khi cai dat package '{package_name}': {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Lỗi hệ thống khi cài đặt: {e}", "output": "", "error_detail": str(e)}), 500

@api_bp.route('/explain', methods=['POST'])
def handle_explain():
    logger = current_app.logger
    data = request.get_json()
    content_to_explain = data.get('content')
    context = data.get('context', 'unknown')
    model_config = data.get('model_config', {})
    file_type = data.get('file_type')

    if not content_to_explain:
        return jsonify({"error": "Không có nội dung để giải thích."}), 400

    if isinstance(content_to_explain, dict) or isinstance(content_to_explain, list):
         try: content_to_explain = json.dumps(content_to_explain, ensure_ascii=False, indent=2)
         except Exception: content_to_explain = str(content_to_explain)
    else:
        content_to_explain = str(content_to_explain)

    explain_context = 'code' if context == 'python_code' else context # Nen map 'python_code'
    language_for_prompt = file_type if explain_context == 'code' else None

    full_prompt = create_explain_prompt(content_to_explain, explain_context, language=language_for_prompt)
    explanation_text = generate_response_from_gemini(full_prompt, model_config, is_for_review_or_debug=True)

    if explanation_text and not explanation_text.startswith("Lỗi"):
        return jsonify({"explanation": explanation_text})

    status_code = 400
    if explanation_text and ("Lỗi cấu hình" in explanation_text or "Lỗi: Phản hồi bị chặn" in explanation_text):
        status_code = 400
    else:
        status_code = 500
    return jsonify({"error": explanation_text or "Lỗi không xác định khi giải thích."}), status_code