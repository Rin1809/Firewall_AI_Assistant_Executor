# backend/execution_utils.py
import os
import subprocess
import re
import shlex
import ctypes
import tempfile
import stat
from datetime import datetime # Them datetime
from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException
from paramiko.ssh_exception import SSHException
from flask import current_app # Su dung current_app thay vi import app
from .helpers import get_os_name
import logging # Them logging neu current_app ko co san logger

# Lenh lay ctx FortiGate
DEFAULT_FORTIGATE_CONTEXT_COMMANDS = [
    "get system status",
    "get system performance status",
    "show system interface",
    "show firewall policy",
    "show firewall address",
    "show firewall vip",
    "show firewall ippool",
    "show firewall service custom",
    "show firewall service group",
    "get router info routing-table all",
    "execute log display event 20", # Lay 20 log event
    "get system dns",
    "get system dhcp server"
    "diagnose debug report", # Lenh nay rat dai, can nhac
    "diagnose sys session list" # Lenh nay cung rat dai
]

# Ham trich xuat khoi ma
def extract_code_block(raw_text, requested_extension, user_input_for_context=""):
    """Trich xuat khoi ma tu phan hoi tho cua Gemini."""
    logger = current_app.logger
    primary_tags = [requested_extension]
    if requested_extension == 'py': primary_tags.append('python')
    if requested_extension == 'sh': primary_tags.extend(['bash', 'shell'])
    if requested_extension == 'bat': primary_tags.append('batch')
    if requested_extension == 'ps1': primary_tags.append('powershell')
    if requested_extension == 'fortios': primary_tags.extend(['cli', 'text'])

    is_fortigate_request = "fortigate" in user_input_for_context.lower() or \
                           "fortios" in user_input_for_context.lower() or \
                           requested_extension == 'fortios'

    if is_fortigate_request:
        if 'fortios' not in primary_tags: primary_tags.insert(0, 'fortios')
        if requested_extension in ['txt', 'conf', 'cli', 'text', 'log']:
             if 'fortios' not in primary_tags: primary_tags.insert(0, 'fortios')
        if 'cli' not in primary_tags: primary_tags.append('cli')
        if 'text' not in primary_tags: primary_tags.append('text')

    unique_primary_tags = []
    for tag in primary_tags:
        if tag and tag not in unique_primary_tags:
            unique_primary_tags.append(tag)

    logger.info(f"Trich xuat code voi tags: {unique_primary_tags} cho ext: .{requested_extension}")

    for tag in unique_primary_tags:
        pattern_strict = r"```" + re.escape(tag) + r"(?:[^\S\n].*?)?\s*\n([\s\S]*?)\n```"
        pattern_flexible = r"```" + re.escape(tag) + r"(?:[^\S\n].*?)?\s*([\s\S]*?)\s*```"

        for p_idx, pattern_str in enumerate([pattern_strict, pattern_flexible]):
            try:
                matches = list(re.finditer(pattern_str, raw_text, re.IGNORECASE))
                if matches:
                    logger.info(f"Tim thay khoi code voi tag: '{tag}' (pattern {p_idx}).")
                    return matches[-1].group(1).strip()
            except re.error as re_err:
                logger.error(f"Loi Regex voi pattern '{pattern_str}' cho tag '{tag}': {re_err}")
                continue

    # Fallback to generic code block
    generic_matches = list(re.finditer(r"```(?:([\w\-\./\+]+)[^\S\n]*)?\s*\n([\s\S]*?)\n```", raw_text))
    if not generic_matches:
        generic_matches = list(re.finditer(r"```(?:([\w\-\./\+]+)[^\S\n]*)?\s*([\s\S]*?)\s*```", raw_text))

    if generic_matches:
        last_block_match = generic_matches[-1]
        lang_tag_found = last_block_match.group(1)
        code_content = last_block_match.group(2).strip()

        if lang_tag_found:
            lang_tag_found = lang_tag_found.strip().lower()
            logger.warning(f"Tim thay khoi code chung voi hint '```{lang_tag_found}```. Dung cho '.{requested_extension}'.")
            if lang_tag_found == 'fortios' and is_fortigate_request: return code_content
            if lang_tag_found == requested_extension or \
               (requested_extension == 'py' and lang_tag_found == 'python') or \
               (requested_extension == 'sh' and lang_tag_found in ['bash', 'shell']) or \
               (requested_extension == 'bat' and lang_tag_found == 'batch') or \
               (requested_extension == 'ps1' and lang_tag_found == 'powershell'):
                return code_content
        else:
            logger.warning(f"Tim thay khoi code ```...``` (khong co hint ngon ngu). Gia su dung cho '.{requested_extension}'.")
        return code_content

    lines = raw_text.splitlines()
    is_likely_direct_code = (
        len(lines) < 30 and
        not any(kw in raw_text.lower() for kw in ["response:", "here's", "this will", "explanation:", "note:", "```"]) and
        not raw_text.startswith("I am a large language model")
    )
    if is_likely_direct_code:
        logger.warning(f"Ko tim thay khoi ```. Tra ve raw text vi giong code truc tiep cho '.{requested_extension}'. Raw: '{raw_text[:100]}...'")
        return raw_text.strip()

    logger.warning(f"Ko tim thay khoi code cho '.{requested_extension}' hoac khoi chung. Tra ve raw text. Raw: '{raw_text[:100]}...'")
    return raw_text.strip()

def execute_fortigate_commands(commands_string, fortigate_config):
    """Thuc thi lenh tren FortiGate qua Netmiko."""
    logger = current_app.logger if hasattr(current_app, 'logger') else logging.getLogger(__name__)
    if not fortigate_config or not isinstance(fortigate_config, dict):
        return {"output": "", "error": "Thiếu cấu hình FortiGate.", "return_code": -1}

    host = fortigate_config.get('ipHost')
    username = fortigate_config.get('username')
    password = fortigate_config.get('password', '')
    port = fortigate_config.get('portSsh', '22')

    if not host or not username:
        return {"output": "", "error": "Thiếu IP/Hostname hoặc Username cho FortiGate.", "return_code": -1}

    try: port = int(port)
    except ValueError:
        return {"output": "", "error": f"Port SSH không hợp lệ: {port}", "return_code": -1}

    # Duong dan log Netmiko: tu backend/logs/netmiko_session.log
    # -> ../logs/netmiko_session.log de ra project_root/logs
    log_file_path = os.path.join(os.path.dirname(__file__), '..', 'logs', 'netmiko_session.log')
    os.makedirs(os.path.dirname(log_file_path), exist_ok=True)


    device = {
        'device_type': 'fortinet', 'host': host, 'username': username, 'password': password, 'port': port,
        'session_log': log_file_path, 'global_delay_factor': 2,
        'conn_timeout': 30, 'auth_timeout': 30, 'banner_timeout': 30,
    }
    output_str, error_str, return_code = "", "", 0
    commands_list = [cmd.strip() for cmd in commands_string.splitlines() if cmd.strip() and not cmd.strip().startswith('#')]
    if not commands_list:
        return {"output": "Không có lệnh hợp lệ để thực thi.", "error": "", "return_code": 0}

    try:
        logger.info(f"Dang ket noi toi FortiGate: {host}:{port} voi user: {username}")
        with ConnectHandler(**device) as net_connect:
            logger.info("Ket noi FortiGate thanh cong.")
            is_config_mode_likely = any(cmd.startswith(("config ", "edit ", "set ", "unset ", "append ", "delete ")) for cmd in commands_list)

            if is_config_mode_likely:
                logger.info("Phat hien lenh config, su dung send_config_set.")
                output_str = net_connect.send_config_set(commands_list, exit_config_mode=True, delay_factor=2, cmd_verify=False)
                if "Command fail" in output_str or "error" in output_str.lower() or "Invalid" in output_str:
                    if not (len(commands_list) == 1 and commands_list[0].strip() == output_str.strip()):
                        error_str = output_str
                        return_code = 1
                        match_error_code = re.search(r"Return code (\-?\d+)", output_str)
                        if match_error_code:
                            try:
                                return_code = int(match_error_code.group(1))
                            except ValueError:
                                pass
                        logger.warning(f"Loi khi thuc thi config tren FortiGate: {output_str}")
                else: logger.info(f"Ket qua config FortiGate:\n{output_str}")
            else:
                logger.info("Chi co lenh show/get/diagnose, su dung send_command cho tung lenh.")
                full_output = []
                for cmd in commands_list:
                    prompt_pattern_str = r"\(.+?\) # $"
                    current_output = net_connect.send_command(
                        cmd,
                        delay_factor=2,
                        expect_string=prompt_pattern_str if re.search(prompt_pattern_str, net_connect.base_prompt) else None
                    )
                    full_output.append(f"$ {cmd}\n{current_output}\n")
                    if "Command fail" in current_output or "command_cli_error" in current_output or "Unknown action" in current_output or "Invalid input" in current_output:
                         error_str += f"Loi khi chay '{cmd}': {current_output}\n"
                         return_code = 1
                         match_error_code = re.search(r"Return code (\-?\d+)", current_output)
                         if match_error_code:
                            try:
                                return_code = int(match_error_code.group(1))
                            except ValueError:
                                pass
                output_str = "\n".join(full_output)
                if return_code == 0: logger.info(f"Ket qua lenh FortiGate:\n{output_str}")
                else: logger.warning(f"Loi khi thuc thi lenh FortiGate: {error_str}")
    except NetmikoTimeoutException as e: error_str, return_code = f"Lỗi Timeout khi kết nối hoặc thực thi lệnh trên FortiGate: {e}", -101; logger.error(error_str)
    except NetmikoAuthenticationException as e: error_str, return_code = f"Lỗi xác thực với FortiGate (sai Username/Password?): {e}", -102; logger.error(error_str)
    except SSHException as e: error_str, return_code = f"Lỗi SSH khi kết nối FortiGate (Port SSH đúng? Firewall?): {e}", -103; logger.error(error_str)
    except Exception as e: error_str, return_code = f"Lỗi không xác định khi thực thi lệnh FortiGate: {e}", -100; logger.error(error_str, exc_info=True)
    return {"output": output_str, "error": error_str, "return_code": return_code}

def fetch_and_save_fortigate_context(fortigate_config, commands_to_fetch=None):
    """
    Lay ngu canh FortiGate, luu file log & tra ve noi dung.
    """
    logger = current_app.logger if hasattr(current_app, 'logger') else logging.getLogger(__name__)
    if not fortigate_config or not isinstance(fortigate_config, dict):
        # Ko raise error o day de route co the xu ly, chi log
        logger.error("fetch_and_save_fortigate_context: Thieu hoac cau hinh FortiGate khong hop le.")
        return "Lỗi: Thiếu cấu hình FortiGate để lấy ngữ cảnh."

    if commands_to_fetch is None:
        commands_to_fetch = DEFAULT_FORTIGATE_CONTEXT_COMMANDS

    commands_string = "\n".join(commands_to_fetch)
    logger.info(f"Bat dau lay ngu canh FortiGate voi cac lenh:\n{commands_string[:500]}...") # Log 1 phan

    result = execute_fortigate_commands(commands_string, fortigate_config)

    context_content = ""
    if result["error"]:
        context_content += f"LOI KHI LAY NGU CANH FORTIGATE:\n{result['error']}\n\n"
        logger.error(f"Loi khi lay ngu canh FortiGate: {result['error']}")

    if result["output"]:
        context_content += result["output"]

    if not context_content.strip():
        context_content = "Khong lay duoc thong tin ngu canh nao tu FortiGate."
        logger.warning("Khong co output nao tu viec lay ngu canh FortiGate.")

    # Thu muc logs o goc project (cung cap voi thu muc backend, frontend)
    # current_app.root_path la backend/
    project_log_dir = os.path.abspath(os.path.join(current_app.root_path, '..', 'logs'))

    if not os.path.exists(project_log_dir):
        try:
            os.makedirs(project_log_dir)
            logger.info(f"Da tao thu muc log du an: {project_log_dir}")
        except OSError as e:
            logger.error(f"Khong the tao thu muc log du an '{project_log_dir}': {e}")
            return context_content # Van tra ve content

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    context_file_path = os.path.join(project_log_dir, f"fortigate_context_{timestamp}.txt")

    try:
        with open(context_file_path, 'w', encoding='utf-8') as f:
            f.write(f"--- FortiGate Context Snapshot at {timestamp} ---\n")
            f.write(f"Target: {fortigate_config.get('ipHost', 'N/A')}\n")
            f.write("--- Commands Executed ---\n")
            f.write(commands_string + "\n")
            f.write("--- Output ---\n")
            f.write(context_content)
        logger.info(f"Da luu ngu canh FortiGate vao: {context_file_path}")
    except IOError as e:
        logger.error(f"Khong the ghi file ngu canh FortiGate '{context_file_path}': {e}")

    return context_content

def execute_local_script(code_to_execute, file_extension, run_as_admin):
    """Thuc thi script local (py, sh, bat, ps1)."""
    logger = current_app.logger
    logger.info(f"--- CANH BAO: Chuan bi thuc thi code file .{file_extension} (Admin/Root: {run_as_admin}) ---")
    temp_file_path = None
    admin_warning = None
    backend_os = get_os_name()

    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix=f'.{file_extension}', delete=False, encoding='utf-8', newline='') as temp_file:
            temp_file_path = temp_file.name
            temp_file.write(code_to_execute)
        logger.info(f"Da luu code vao file tam: {temp_file_path}")

        if backend_os in ["linux", "macos"] and file_extension in ['sh', 'py']:
            try:
                current_stat = os.stat(temp_file_path).st_mode
                os.chmod(temp_file_path, current_stat | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                logger.info(f"Da cap quyen thuc thi (chmod +x) cho: {temp_file_path}")
            except Exception as chmod_e:
                logger.error(f"Ko the cap quyen thuc thi file tam: {chmod_e}")

        import sys
        interpreter_path = sys.executable
        command_map = {
            'py': [interpreter_path, temp_file_path],
            'bat': {'windows': ['cmd', '/c', temp_file_path]},
            'ps1': {'windows': ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', temp_file_path]},
            'sh':  {'linux': ['bash', temp_file_path], 'macos': ['bash', temp_file_path]}
        }
        command = command_map.get(file_extension)
        if isinstance(command, dict):
            command = command.get(backend_os)

        if not command:
            if backend_os == 'windows': command = ['cmd', '/c', temp_file_path]
            else: command = ['bash', temp_file_path]
            logger.warning(f"Loai file '.{file_extension}' ko xd ro tren {backend_os}, thu chay bang {'cmd /c' if backend_os == 'windows' else 'bash'}.")

        if run_as_admin:
            if backend_os == "windows":
                try:
                    is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
                    if not is_admin:
                        admin_warning = "Yeu cau Admin, nhung backend ko co quyen. Thuc thi quyen thuong."
                except Exception as admin_check_e:
                    admin_warning = f"Ko the check admin ({admin_check_e}). Thuc thi quyen thuong."
            elif backend_os in ["linux", "darwin"]: # darwin la macos
                try:
                    # Ktra sudo co ton tai ko
                    subprocess.run(['which', 'sudo'], check=True, capture_output=True, text=True, errors='ignore')
                    command.insert(0, 'sudo')
                except (FileNotFoundError, subprocess.CalledProcessError):
                     admin_warning = "Yeu cau Root, nhung ko tim thay 'sudo'. Thuc thi quyen thuong."
                except Exception as sudo_check_e:
                     admin_warning = f"Loi khi check sudo ({sudo_check_e}). Thuc thi quyen thuong."
            else:
                admin_warning = f"Yeu cau 'Admin/Root' ko ho tro tren HDH ({backend_os}). Thuc thi quyen thuong."
            if admin_warning: logger.warning(f"{admin_warning}")

        logger.info(f"Chuan bi chay lenh: {' '.join(shlex.quote(str(c)) for c in command)}")
        process_env = os.environ.copy()
        process_env["PYTHONIOENCODING"] = "utf-8"

        result = subprocess.run(
            command, capture_output=True, encoding='utf-8', errors='replace',
            timeout=60, check=False, env=process_env, text=True
        )

        logger.info(f"--- Ket qua thuc thi (Ma tra ve: {result.returncode}) ---")
        if result.stdout: logger.info(f"Output:\n{result.stdout}")
        if result.stderr: logger.info(f"Loi Output:\n{result.stderr}")

        message = "Thực thi file thành công." if result.returncode == 0 else "Thực thi file hoàn tất (có thể có lỗi)."
        response_data = {
            "message": message, "output": result.stdout, "error": result.stderr, "return_code": result.returncode,
            "executed_file_type": file_extension,
            "codeThatFailed": code_to_execute
        }
        if admin_warning: response_data["warning"] = admin_warning
        return response_data

    except subprocess.TimeoutExpired:
        logger.error("Loi: Thuc thi file qua thoi gian (60s).")
        return {"error_type": "Timeout", "message": "Thực thi file vượt quá thời gian cho phép.", "output": "", "error_detail": "Timeout", "return_code": -1, "warning": admin_warning, "codeThatFailed": code_to_execute}
    except FileNotFoundError as fnf_error:
        missing_cmd = str(fnf_error)
        err_msg = f"Lỗi hệ thống: Không tìm thấy lệnh '{missing_cmd}' de chay file .{file_extension}."
        if 'sudo' in missing_cmd and run_as_admin and backend_os != "windows":
             err_msg = "Lỗi hệ thống: Lệnh 'sudo' không được tìm thấy. Không thể chạy với quyền root."
        logger.error(f"{err_msg}")
        return {"error_type": "FileNotFound", "message": err_msg, "output": "", "error_detail": f"FileNotFoundError: {missing_cmd}", "return_code": -1, "warning": admin_warning, "codeThatFailed": code_to_execute}
    except Exception as e:
        logger.error(f"Loi nghiem trong khi thuc thi file tam: {e}", exc_info=True)
        return {"error_type": "Exception", "message": f"Lỗi hệ thống khi thực thi file: {e}", "output": "", "error_detail": str(e), "return_code": -1, "warning": admin_warning, "codeThatFailed": code_to_execute}
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Da xoa file tam: {temp_file_path}")
            except Exception as cleanup_e:
                logger.error(f"Ko the xoa file tam {temp_file_path}: {cleanup_e}")