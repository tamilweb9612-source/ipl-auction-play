
import re

file_path = 'd:/auction-multiplayer/script.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
in_db = False
buffer = ""
db_indent = ""

# Regex to identify the start of a player entry
# It looks like: "Name": {
player_start_pat = re.compile(r'^\s*"[^"]+":\s*\{')

for i, line in enumerate(lines):
    # Detect start of PLAYER_DATABASE
    if "const PLAYER_DATABASE = {" in line:
        in_db = True
        new_lines.append(line)
        continue
    
    # Detect end of PLAYER_DATABASE
    if in_db and line.strip() == "};":
        if buffer:
            # flush any remaining buffer (shouldn't really happen if structure is consistent)
            new_lines.append(buffer)
            buffer = ""
        in_db = False
        new_lines.append(line)
        continue

    if in_db:
        stripped = line.strip()
        # If it's a comment or empty line, keep it as is, unless we are buffering a player
        if stripped.startswith("//") or not stripped:
            if buffer:
                new_lines.append(buffer + "\n")
                buffer = ""
            new_lines.append(line)
            continue
            
        # If we encounter a new player start, flush previous buffer
        if player_start_pat.match(stripped):
            if buffer:
                new_lines.append(buffer + "\n")
            # Start new buffer
            # Keep indentation of the key
            # But we want to collapse the rest
            # The structure is: "Name": {\n ... \n  },
            buffer = line.rstrip() # Start the line
        else:
            # It's part of the current object content
            # Add to buffer, removing extra whitespace
            if buffer:
                buffer += " " + stripped
            else:
                # Should not happen if format is consistent, but if so just add
                new_lines.append(line)
                
        # If line ends with "}," or "}" it might be the end of the object
        # but we handle that by accumulating until the next start or end of DB?
        # Actually, "}," indicates end of player object usually.
        # Let's check if the buffer ends with "}," or "}"
        if buffer and (buffer.endswith("},") or buffer.endswith("}")):
             # We found the end of an entry
             # Clean up the buffer: remove multiple spaces, fix colons syntax consistency if needed
             # The user code has `key: value,`
             
             new_lines.append(buffer + "\n")
             buffer = ""
             
    else:
        new_lines.append(line)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
