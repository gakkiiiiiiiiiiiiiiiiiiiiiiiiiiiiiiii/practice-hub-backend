import pdfplumber

def peek_pdf(file_path, num_pages=3):
    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages[:num_pages]):
            print(f"--- Page {i+1} ---")
            print(page.extract_text())
            print("\n")

if __name__ == "__main__":
    peek_pdf('/Users/pangyujie/pro-project/practice-hub/back-end/test-files/题库.pdf')
