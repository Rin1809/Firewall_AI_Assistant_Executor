# backend/prompt_utils.py
import os
import json
from flask import current_app
import logging # Them logging
from .helpers import get_language_name

# Ham doc nd file prompt instruction/example
def read_prompt_file(filename, default_content=""):
    """Doc file instruction/example, fallback default."""
    prompt_data_dir = current_app.config.get('PROMPT_DATA_DIR', os.path.join(os.path.dirname(__file__), 'prompt_data'))
    logger = current_app.logger

    filepath = os.path.join(prompt_data_dir, filename)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except FileNotFoundError:
        logger.warning(f"File prompt '{filepath}' ko tim thay. Dung default.")
        default_filepath = os.path.join(prompt_data_dir, f"default_{filename.split('_', 1)[-1]}")
        try:
            with open(default_filepath, 'r', encoding='utf-8') as f_default:
                return f_default.read().strip()
        except FileNotFoundError:
            logger.error(f"Ca file prompt '{filepath}' & default '{default_filepath}' ko tim thay.")
            return default_content
    except Exception as e:
        logger.error(f"Loi doc file prompt '{filepath}': {e}")
        return default_content

# Ham load template prompt chinh
def load_prompt_template(filename, default_content=""):
    """Load template prompt chinh tu thu muc prompts."""
    prompts_dir = current_app.config.get('PROMPTS_DIR', os.path.join(os.path.dirname(__file__), 'prompt_data', 'prompts'))
    logger = current_app.logger
    filepath = os.path.join(prompts_dir, filename)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read() # Ko .strip()
    except FileNotFoundError:
        logger.error(f"Template prompt '{filepath}' ko tim thay.")
        return default_content
    except Exception as e:
        logger.error(f"Loi doc template prompt '{filepath}': {e}")
        return default_content

# Ham tao prompt yeu cau Gemini sinh code/lenh
def create_prompt(user_input, backend_os_name, target_os_name, file_type, fortigate_context_data=None):
    """Tao prompt sinh code/lenh."""
    file_extension = ""
    file_type_description = ""
    if file_type and '.' in file_type:
        file_extension = file_type.split('.')[-1].lower()
        file_type_description = f"một file có tên `{file_type}`"
    elif file_type:
        file_extension = file_type.lower()
        file_type_description = f"một file loại `.{file_extension}` ({get_language_name(file_extension)})"
    else:
        file_extension = "py" # Mac dinh
        file_type_description = f"một script Python (`.{file_extension}`)"

    code_block_tag = file_extension if file_extension and file_extension.isalnum() else 'code'

    is_target_fortios = target_os_name.lower() == 'fortios'
    is_fortigate_request_context_input = "fortigate" in user_input.lower() or "fortios" in user_input.lower()

    lang_key_for_prompt_files = file_extension
    if is_target_fortios and file_extension in ['txt', 'conf', 'cli', 'log', 'fortios']:
        lang_key_for_prompt_files = 'fortios'
        code_block_tag = 'fortios'
        file_type_description = f"các lệnh FortiOS CLI (thường lưu dưới dạng `.{file_extension}` hoặc tương tự, để chạy trên FortiGate)"
    elif is_fortigate_request_context_input and file_extension in ['txt', 'conf', 'cli', 'fortios', 'log']:
        lang_key_for_prompt_files = 'fortios'
        code_block_tag = 'fortios'
        file_type_description = f"các lệnh FortiOS CLI (thường lưu dưới dạng `.{file_extension}` hoặc tương tự)"
    elif file_extension == 'fortios':
        lang_key_for_prompt_files = 'fortios'
        code_block_tag = 'fortios'
        file_type_description = f"các lệnh FortiOS CLI (để chạy trên FortiGate)"

    language_specific_instructions = read_prompt_file(f"{lang_key_for_prompt_files}_instructions.txt", read_prompt_file("default_instructions.txt"))
    language_specific_examples = read_prompt_file(f"{lang_key_for_prompt_files}_exp.txt", read_prompt_file("default_exp.txt"))

    script_cli_guidance = ""
    if lang_key_for_prompt_files == 'fortios':
        script_cli_guidance = f"""
6.  Nếu là các lệnh CLI cho thiết bị (ví dụ: FortiGate, mục tiêu là `{target_os_name}`):
{language_specific_instructions}"""
    else:
        script_cli_guidance = f"""
5.  Nếu là script ({get_language_name(lang_key_for_prompt_files)}):
{language_specific_instructions}"""

    prompt_template = load_prompt_template("generate_code_prompt.txt")
    if not prompt_template:
        return "Lỗi: Không thể tải template prompt để sinh mã."

    fortigate_context_section_str = ""
    if fortigate_context_data and \
       (is_target_fortios or is_fortigate_request_context_input or lang_key_for_prompt_files == 'fortios'):
        # Bo sung them thong tin ngu canh FortiGate
        fortigate_context_section_str = f"""
**Thông tin ngữ cảnh FortiGate hiện tại (được trích xuất tự động để Gemini tham khảo):**
```text
{fortigate_context_data[:15000]}
```
""" # Gioi han do dai context neu qua lon

    return prompt_template.format(
        backend_os_name=backend_os_name,
        target_os_name=target_os_name,
        file_type_description=file_type_description,
        code_block_tag=code_block_tag,
        script_cli_guidance=script_cli_guidance,
        language_specific_examples=language_specific_examples,
        user_input=user_input,
        fortigate_context_section=fortigate_context_section_str
    ).strip()

# Ham tao prompt yeu cau Gemini danh gia code
def create_review_prompt(code_to_review, language):
    """Tao prompt danh gia code."""
    language_name = get_language_name(language)
    code_block_tag = language if language and language.isalnum() else 'code'
    if language == 'fortios': code_block_tag = 'fortios'

    prompt_template = load_prompt_template("review_code_prompt.txt")
    if not prompt_template:
        return "Lỗi: Không thể tải template prompt để đánh giá mã."

    return prompt_template.format(
        language_name=language_name,
        code_block_tag=code_block_tag,
        code_to_review=code_to_review
    ).strip()

# Ham tao prompt yeu cau Gemini go loi code
def create_debug_prompt(original_prompt, failed_code, stdout, stderr, language, fortigate_context_data=None):
    """Tao prompt go loi code."""
    language_name = get_language_name(language)
    code_block_tag = language if language and language.isalnum() else 'code'
    if language == 'fortios': code_block_tag = 'fortios'

    processed_original_prompt = original_prompt if original_prompt and original_prompt.strip() else "(Không có hoặc prompt rỗng)"
    processed_stdout = stdout if stdout and stdout.strip() else "(Không có output stdout)"
    processed_stderr = stderr if stderr and stderr.strip() else "(Không có output stderr)"

    prompt_template = load_prompt_template("debug_code_prompt.txt")
    if not prompt_template:
        return "Lỗi: Không thể tải template prompt để gỡ lỗi mã."

    fortigate_context_section_str = ""
    if fortigate_context_data and \
       (language.lower() == 'fortios' or \
        (original_prompt and ("fortigate" in original_prompt.lower() or "fortios" in original_prompt.lower()))):
        # Them ctx FGT cho debug
        fortigate_context_section_str = f"""
**Thông tin ngữ cảnh FortiGate tại thời điểm trước khi chạy lệnh gây lỗi (được trích xuất tự động để Gemini tham khảo):**
```text
{fortigate_context_data[:15000]}
```
""" # Gioi han do dai context

    return prompt_template.format(
        language_name=language_name,
        code_block_tag=code_block_tag,
        processed_original_prompt=processed_original_prompt,
        failed_code=failed_code,
        processed_stdout=processed_stdout,
        processed_stderr=processed_stderr,
        fortigate_context_section=fortigate_context_section_str
    ).strip()

# Ham tao prompt yeu cau Gemini giai thich
def create_explain_prompt(content_to_explain, context, language=None):
    """Tao prompt giai thich."""
    prompt_header = "Bạn là một trợ lý AI giỏi giải thích các khái niệm kỹ thuật một cách đơn giản, dễ hiểu cho người dùng không chuyên."
    prompt_instruction_base = "Giải thích nội dung sau đây bằng tiếng Việt, sử dụng Markdown, tập trung vào ý nghĩa chính và những điều người dùng cần biết. Giữ cho giải thích ngắn gọn và rõ ràng. Bắt đầu trực tiếp bằng nội dung giải thích, không thêm lời dẫn."
    context_description = ""
    language_name = get_language_name(language) if language else "nội dung"
    code_block_tag = language if language and language.isalnum() else 'code'
    if language == 'fortios': code_block_tag = 'fortios'

    try:
        if isinstance(content_to_explain, str) and content_to_explain.strip().startswith('{') and content_to_explain.strip().endswith('}'):
             parsed_json = json.loads(content_to_explain)
             content_to_explain_formatted = json.dumps(parsed_json, ensure_ascii=False, indent=2)
        else:
             content_to_explain_formatted = str(content_to_explain)
    except json.JSONDecodeError:
         content_to_explain_formatted = str(content_to_explain)

    final_prompt_instruction = prompt_instruction_base

    if context == 'code':
        context_description = f"Đây là một đoạn mã **{language_name}**:\n```{code_block_tag}\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = f"Giải thích đoạn mã **{language_name}** này làm gì, mục đích chính của nó là gì, và tóm tắt các bước thực hiện chính (nếu có). Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    elif context == 'execution_result':
        context_description = f"Đây là kết quả sau khi thực thi một đoạn mã:\n```json\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = "Phân tích kết quả thực thi này (stdout, stderr, mã trả về). Cho biết lệnh có vẻ đã thành công hay thất bại và giải thích ngắn gọn tại sao dựa trên kết quả. Lưu ý cả các cảnh báo (warning) nếu có. Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    elif context == 'review_text':
        context_description = f"Đây là một bài đánh giá code:\n```markdown\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = "Tóm tắt và giải thích những điểm chính của bài đánh giá code này bằng ngôn ngữ đơn giản hơn. Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    elif context == 'debug_result':
        debug_language = language
        if isinstance(content_to_explain, str):
            try:
                parsed_debug = json.loads(content_to_explain)
                debug_language = parsed_debug.get('original_language', language)
            except json.JSONDecodeError: pass
        elif isinstance(content_to_explain, dict):
             debug_language = content_to_explain.get('original_language', language)
        language_name_for_debug = get_language_name(debug_language) if debug_language else "code"
        context_description = f"Đây là kết quả từ việc gỡ lỗi một đoạn mã {language_name_for_debug}:\n```json\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = f"Giải thích kết quả gỡ lỗi này, bao gồm nguyên nhân lỗi được xác định, ý nghĩa của đề xuất cài đặt package (nếu có và chỉ cho Python), và mục đích của đoạn code {language_name_for_debug} đã sửa (nếu có). Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    elif context == 'error_message':
        context_description = f"Đây là một thông báo lỗi:\n```\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = "Giải thích thông báo lỗi này có nghĩa là gì, nguyên nhân phổ biến có thể gây ra nó, và gợi ý hướng khắc phục (nếu có thể). Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    elif context == 'installation_result':
        context_description = f"Đây là kết quả sau khi cài đặt một package Python:\n```json\n{content_to_explain_formatted}\n```"
        final_prompt_instruction = "Phân tích kết quả cài đặt package này. Cho biết việc cài đặt thành công hay thất bại, và giải thích ngắn gọn output/error từ pip. Trả lời bằng tiếng Việt, sử dụng Markdown. Bắt đầu trực tiếp bằng nội dung giải thích."
    else:
         context_description = f"Nội dung cần giải thích:\n```\n{content_to_explain_formatted}\n```"

    prompt_template = load_prompt_template("explain_content_prompt.txt")
    if not prompt_template:
        return "Lỗi: Không thể tải template prompt để giải thích."

    return prompt_template.format(
        prompt_header=prompt_header,
        context_description=context_description,
        prompt_instruction=f"\n\n**Yêu cầu:** {final_prompt_instruction}"
    ).strip()
