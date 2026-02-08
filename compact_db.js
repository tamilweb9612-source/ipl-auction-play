
const fs = require('fs');
const path = 'd:/auction-multiplayer/script.js';

try {
    const data = fs.readFileSync(path, 'utf8');
    const lines = data.split(/\r?\n/);
    let newLines = [];
    let inDb = false;
    let buffer = "";

    const playerStartRegex = /^\s*"[^"]+":\s*\{/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes("const PLAYER_DATABASE = {")) {
            inDb = true;
            newLines.push(line);
            continue;
        }

        if (inDb && line.trim() === "};") {
            if (buffer) {
                newLines.push(buffer);
                buffer = "";
            }
            inDb = false;
            newLines.push(line);
            continue;
        }

        if (inDb) {
            const stripped = line.trim();
            
            if (stripped.startsWith("//") || stripped === "") {
                if (buffer) {
                    newLines.push(buffer);
                    buffer = "";
                }
                newLines.push(line);
                continue;
            }

            if (playerStartRegex.test(stripped)) {
                if (buffer) {
                    newLines.push(buffer);
                }
                buffer = line.trimEnd();
            } else {
                if (buffer) {
                    buffer += " " + stripped;
                } else {
                   // Should technically not happen if structure matches expectation, 
                   // but strictly keeping non-matching lines safe
                   newLines.push(line);
                }
            }

            if (buffer && (buffer.endsWith("},") || buffer.endsWith("}"))) {
                newLines.push(buffer);
                buffer = "";
            }

        } else {
            newLines.push(line);
        }
    }

    fs.writeFileSync(path, newLines.join('\n'), 'utf8');
    console.log("Success");

} catch (err) {
    console.error(err);
}
