# backend/helpers.py
import sys

# Clean ten HDH
def get_os_name(platform_str=None):
    """Lay ten HDH tu platform string."""
    p_str = platform_str if platform_str is not None else sys.platform
    if p_str == "win32": return "windows"
    if p_str == "darwin": return "macos"
    return "linux" # mac dinh linux

# Helper anh xa ext sang ten ngon ngu
def get_language_name(file_ext):
    """Lay ten ngon ngu tu extension."""
    if not file_ext: return "code"
    ext_lower = file_ext.lower()
    if ext_lower == 'py': return 'Python'
    if ext_lower == 'sh': return 'Shell Script (Bash)'
    if ext_lower == 'bat': return 'Batch Script'
    if ext_lower == 'ps1': return 'PowerShell'
    if ext_lower == 'js': return 'JavaScript'
    if ext_lower == 'ts': return 'TypeScript'
    if ext_lower == 'html': return 'HTML'
    if ext_lower == 'css': return 'CSS'
    if ext_lower == 'json': return 'JSON'
    if ext_lower == 'yaml': return 'YAML'
    if ext_lower == 'sql': return 'SQL'
    if ext_lower == 'fortios': return 'FortiOS CLI'
    if ext_lower == 'conf': return 'Config File (FortiOS)'
    return f'file .{ext_lower}'