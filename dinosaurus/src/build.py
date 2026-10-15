# 공룡 앱 빌드: head.html + three_block.html(Three.js r186 묶음) + app.js → ../index.html (파일 하나)
# 사용법: python dinosaurus/src/build.py   (어느 폴더에서 실행해도 됨)
import os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda n: open(os.path.join(here, n), encoding='utf-8').read()
out = rd('head.html') + '\n<!-- Three.js r186 (몬스터 앱과 같은 묶음). 파일 하나로 더블클릭 실행·호스팅 모두 가능 -->\n' + rd('three_block.html').strip() + '\n\n<script>\n' + rd('app.js') + '</script>\n</body>\n</html>\n'
dst = os.path.join(here, '..', 'index.html')
with open(dst, 'w', encoding='utf-8', newline='\n') as f: f.write(out)
print('built', os.path.normpath(dst), len(out.encode()), 'bytes')
