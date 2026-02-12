import pdfplumber
import re
import json
import sys

def is_page_number(line):
    # Matches simple numbers like "1", " 1 ", "- 1 -"
    return re.match(r'^\s*-?\s*\d+\s*-?\s*$', line)

def is_toc_line(line):
    # TOC lines often end with page number or section number like "1.1" or "1.2.3"
    # Example: "简介 1.1", "五、材料分析题 1.2.5"
    if re.search(r'\d+\.\d+(\.\d+)*\s*$', line):
        return True
    return False

def clean_text(text):
    if not text: return ""
    return text.strip()

def parse_options(text_lines):
    # Heuristic to extract options from a list of lines belonging to a question
    # Returns a dict of options and the remaining text (if any mixed in, usually options are at the end)
    options = {}
    
    # Pattern for "A. xxx" or "A、xxx"
    # We look for A, B, C, D at the start of lines or preceded by spaces
    
    # Join lines to handle inline options better?
    # Risk: "A. text B. text"
    
    combined_text = " ".join(text_lines)
    
    # Regex to find options
    # We look for [A-Z] followed by . or 、
    # We capture the letter and the content until the next option or end of string
    
    # This regex looks for A. (content) B. (content) ...
    # (?=[A-Z][\.\、]) is a lookahead for the next option
    
    pattern = r'([A-Z])[\.\、]\s*(.*?)(?=\s+[A-Z][\.\、]|$)'
    # Note: This might fail if the text contains "U.S." or similar.
    # But for exam papers, usually A, B, C, D are clear.
    
    # A more robust way:
    # 1. Find all occurrences of "A.", "B.", "C.", "D."
    # 2. Split string based on indices.
    
    matches = list(re.finditer(r'(^|\s)([A-Z])[\.\、]', combined_text))
    
    if not matches:
        return {}
    
    for i, match in enumerate(matches):
        start = match.end()
        letter = match.group(2)
        
        if i < len(matches) - 1:
            end = matches[i+1].start()
            content = combined_text[start:end]
        else:
            content = combined_text[start:]
            
        options[letter] = content.strip()
        
    return options

def get_question_type(section_header, options, answer):
    # Default based on section
    q_type = "简答题"
    
    if "单项选择" in section_header or "单选" in section_header:
        q_type = "单选"
    elif "多项选择" in section_header or "多选" in section_header:
        q_type = "多选"
    elif "判断" in section_header:
        q_type = "判断"
    elif "填空" in section_header:
        q_type = "填空"
    elif "材料" in section_header or "阅读" in section_header:
        q_type = "阅读理解"
    elif "概念" in section_header or "简答" in section_header or "论述" in section_header:
        q_type = "简答题"
        
    # Override based on options/answer
    if not options and q_type not in ["填空", "简答题", "阅读理解"]:
        # If expected choice but no options found, fallback to Short Answer
        # But maybe we just failed to parse options?
        # User rule: "If no options provided... classify as Short Answer"
        q_type = "简答题"
        
    if options:
        if q_type == "简答题":
            # If we found options but thought it was Short Answer, upgrade to Choice
            # Check answer to decide Single vs Multi
            if "," in answer or len(answer) > 1: # Assuming answer is "AB" or "A,B"
                 q_type = "多选"
            else:
                 q_type = "单选"
                 
    return q_type

def main():
    pdf_path = '/Users/pangyujie/pro-project/practice-hub/back-end/test-files/题库.pdf'
    output_path = '/Users/pangyujie/pro-project/practice-hub/back-end/questions.json'
    
    questions = []
    
    current_question = None
    current_section = "简答题" # Default
    
    # State tracking
    # We will accumulate lines for different parts
    current_lines = {
        "question": [],
        "options": [],
        "answer": [],
        "explanation": []
    }
    
    state = "IDLE" # IDLE, QUESTION, ANSWER, EXPLANATION
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text: continue
            
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line: continue
                if is_page_number(line): continue
                if is_toc_line(line): continue
                
                # Check for Section Headers
                # Heuristic: Chinese numbers followed by type
                # Allow for different separators
                if re.match(r'^[一二三四五六七八九十]+[、\.．\s]', line):
                    # Save previous question if exists
                    if current_question:
                        # Process and Save
                        process_and_save(questions, current_question, current_lines, current_section)
                        current_question = None
                        current_lines = {"question": [], "options": [], "answer": [], "explanation": []}
                        state = "IDLE"

                    current_section = line
                    # Map section text to type immediately? No, do it at the end.
                    continue
                
                # Check for New Question (Number + Dot)
                # Matches "1. ", "2. "
                # Exclude "1.1" (Subsections in TOC) - Check if char after dot is space
                if re.match(r'^\d+\.\s', line):
                    # Save previous
                    if current_question:
                        process_and_save(questions, current_question, current_lines, current_section)
                    
                    # Start New
                    current_question = True # Flag
                    current_lines = {
                        "question": [line],
                        "options": [],
                        "answer": [],
                        "explanation": []
                    }
                    state = "QUESTION"
                    continue
                
                # Check for Answer
                if line.startswith("【答案】"):
                    state = "ANSWER"
                    content = line.replace("【答案】", "").strip()
                    if content:
                        current_lines["answer"].append(content)
                    continue
                    
                # Check for Explanation
                if line.startswith("【解析】"):
                    state = "EXPLANATION"
                    content = line.replace("【解析】", "").strip()
                    if content:
                        current_lines["explanation"].append(content)
                    continue
                
                # Content processing based on state
                if state == "QUESTION":
                    # Check if this line looks like an option
                    # If it starts with A. B. C. D.
                    if re.match(r'^[A-Z][\.\、]', line):
                        current_lines["options"].append(line)
                    else:
                        # Check if it contains options inline?
                        # If we haven't seen options yet, and this line has "A. ... B. ...", it's part of options?
                        # For now, append to question text. 
                        # We will extract options from question text + option lines later.
                        current_lines["question"].append(line)
                        
                elif state == "ANSWER":
                    current_lines["answer"].append(line)
                    
                elif state == "EXPLANATION":
                    current_lines["explanation"].append(line)

        # Save last question
        if current_question:
             process_and_save(questions, current_question, current_lines, current_section)

    # Output to JSON
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)
    
    print(f"Extracted {len(questions)} questions.")

def process_and_save(questions_list, has_q, lines, section_header):
    # Construct the question object
    
    # 1. Parse Options
    # Combine question text lines to look for options too, or just use lines identified as options?
    # Sometimes options are part of the question text block in extraction.
    # Let's try to extract options from the raw question lines + option lines.
    
    full_text = lines["question"] + lines["options"]
    
    # We need to separate Question Body from Options
    # Heuristic: Options start from the first "A." or "A、"
    
    q_text_body = []
    opt_lines = []
    found_opt = False
    
    for line in full_text:
        if found_opt:
            opt_lines.append(line)
            continue
            
        # Check if line starts with Option
        if re.match(r'^[A-Z][\.\、]', line):
            found_opt = True
            opt_lines.append(line)
            continue
            
        # Check if line contains option inline (e.g. ".... ( ) A. xxx")
        # Be careful not to split question text.
        match = re.search(r'\s[A-Z][\.\、]', line)
        if match:
            # This is hard to split perfectly without more logic.
            # If the line is "Which is correct? A. Yes B. No"
            # We treat the whole line as containing options.
            # But we need to keep "Which is correct?" in q_text_body.
            
            # Simple approach: If line has options, pass it to option parser
            # But we need to remove the options from q_text_body.
            
            # Let's rely on parse_options to extract from the combined string of lines that look like options.
            # If a line starts with "A.", it's definitely option.
            # If it doesn't, it's question.
            q_text_body.append(line)
        else:
            q_text_body.append(line)

    # Actually, `parse_options` below is better.
    # We pass ALL text. It extracts A... B... 
    # Whatever is before A... is question? No, that's risky.
    
    # Revised approach:
    # 1. Join all lines.
    # 2. Find index of "A." or "A、" (start of options).
    # 3. Everything before is Question. Everything after is Options.
    
    full_str = " ".join(full_text)
    
    # Find first occurrence of "A." or "A、" that looks like an option start
    # (Start of line or preceded by space)
    opt_start_match = re.search(r'(^|\s)A[\.\、]', full_str)
    
    final_q_text = ""
    options_dict = {}
    
    if opt_start_match:
        start_idx = opt_start_match.start()
        # If it matched space, we need to adjust
        if full_str[start_idx] == ' ':
            start_idx += 1
            
        final_q_text = full_str[:start_idx].strip()
        opts_str = full_str[start_idx:]
        
        # Parse options from opts_str
        # Reuse logic
        # We need to handle A, B, C, D
        options_dict = parse_options_from_str(opts_str)
    else:
        final_q_text = full_str.strip()
        options_dict = {}
        
    # Answer
    ans_str = " ".join(lines["answer"]).strip()
    
    # Explanation
    exp_str = " ".join(lines["explanation"]).strip()
    
    # Determine Type
    q_type = get_question_type(section_header, options_dict, ans_str)
    
    # User Rule: No options -> Short Answer
    if not options_dict:
        # Unless it's Fill in the blank? User says "Fill in blank... answer is text".
        # But Fill in blank usually doesn't have options A,B,C,D.
        # So if options_dict is empty, it's Short Answer or Fill or Reading.
        # We trust get_question_type which defaults to Short Answer or Reading.
        # If section was "单选" but no options found -> Force Short Answer per rule.
        if q_type in ["单选", "多选"]:
             q_type = "简答题"
             
    # Format Answer
    # If type is choice, answer should be letters.
    # If text is "A" or "A, B", keep it.
    
    q_obj = {
        "type": q_type,
        "question": final_q_text,
        "options": options_dict,
        "answer": ans_str,
        "explanation": exp_str
    }
    
    questions_list.append(q_obj)

def parse_options_from_str(text):
    options = {}
    # Find all [A-Z]. or [A-Z]、
    # We assume they are in order A, B, C... or at least distinct
    
    # Regex to find markers
    pattern = r'(?:^|\s)([A-Z])[\.\、]'
    matches = list(re.finditer(pattern, text))
    
    if not matches:
        return {}
        
    for i, match in enumerate(matches):
        letter = match.group(1)
        start = match.end()
        
        if i < len(matches) - 1:
            end = matches[i+1].start()
            content = text[start:end]
        else:
            content = text[start:]
            
        options[letter] = content.strip()
        
    return options

if __name__ == "__main__":
    main()
