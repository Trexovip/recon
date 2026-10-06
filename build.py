# Assembles public/index.html from the ui/ folder
import pathlib
u=pathlib.Path(__file__).parent/'ui'
js='\n'.join((u/f).read_text() for f in ['core.js','pages1.js','pages2.js','pages3.js'])
html=f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Balance Reconciliation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
{(u/'styles.css').read_text()}</style>
</head>
{(u/'shell.html').read_text()}<script>
{js}</script>
</body>
</html>
'''
(pathlib.Path(__file__).parent/'public'/'index.html').write_text(html)
(pathlib.Path('/tmp/all.js')).write_text(js)
