import os

paths = [
    '/Users/mbuharia/.gemini/antigravity/scratch/qc-module-ui/index.html',
    '/Users/mbuharia/.gemini/antigravity/scratch/qc-module-ui/workflow.html',
    '/Users/mbuharia/.gemini/antigravity/scratch/qc-module-ui/app.js',
    '/Users/mbuharia/Desktop/Open_QC_System.html',
    '/Users/mbuharia/Desktop/QC_Workflow_Blueprint.html',
    '/Users/mbuharia/Desktop/Open_QA_System.html',
    '/Users/mbuharia/Desktop/QA_Workflow_Blueprint.html'
]

replacements = [
    ('Quality Control', 'Quality Assurance'),
    ('Quality control', 'Quality assurance'),
    ('quality control', 'quality assurance'),
    ('QC', 'QA'),
    ('qc', 'qa')
]

for path in paths:
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        new_content = content
        for old, new in replacements:
            new_content = new_content.replace(old, new)
        
        if new_content != content:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated {path}")
        else:
            print(f"No changes needed for {path}")
    else:
        print(f"File not found: {path}")
