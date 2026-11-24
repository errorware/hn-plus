"""Local test harness for HN+.

Serves snapshots of real HN pages with hn-plus.user.js injected and a
localStorage-backed stand-in for Tampermonkey's GM_* APIs.

    python3 dev/harness.py            # fetches snapshots on first run
    python3 dev/harness.py --refresh  # re-fetch snapshots

Then open http://localhost:8765/news, /item?id=1 or /newcomments.
Snapshots live in dev/pages/ (git-ignored).

Add ?demo to any page to seed sample state (users, a word swap, NEW
comments); ?demo=settings also opens the settings panel and ?demo=card
opens a user hover card. Used for the README screenshots.
"""
import http.server
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES_DIR = os.path.join(ROOT, 'pages')
SCRIPT = os.path.join(ROOT, '..', 'hn-plus.user.js')
HN = 'https://news.ycombinator.com'
PORT = 8765

SHIM = """<script>
window.GM_getValue=(k)=>{const v=localStorage.getItem('gm_'+k);return v==null?undefined:JSON.parse(v)};
window.GM_setValue=(k,v)=>localStorage.setItem('gm_'+k,JSON.stringify(v));
window.GM_registerMenuCommand=()=>{};
window.onerror=(m,s,l,c)=>{(window.__errs=window.__errs||[]).push(m+' @'+l+':'+c)};
</script><script src="/__hnp.js"></script>"""

PAGES = {'/': 'front.html', '/news': 'front.html', '/item': 'item.html', '/newcomments': 'newcomments.html'}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'hn-plus-dev-harness'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode('utf-8')


def snapshot(refresh=False):
    os.makedirs(PAGES_DIR, exist_ok=True)
    path = lambda name: os.path.join(PAGES_DIR, name)
    if refresh or not os.path.exists(path('front.html')):
        open(path('front.html'), 'w').write(fetch(HN + '/'))
    if refresh or not os.path.exists(path('newcomments.html')):
        open(path('newcomments.html'), 'w').write(fetch(HN + '/newcomments'))
    if refresh or not os.path.exists(path('item.html')):
        # the front-page story with the most comments makes the best test thread
        front = open(path('front.html')).read()
        counts = re.findall(r'item\?id=(\d+)">(\d+)&nbsp;comments', front)
        best = max(counts, key=lambda c: int(c[1]))[0] if counts else re.search(r'item\?id=(\d+)', front).group(1)
        open(path('item.html'), 'w').write(fetch(f'{HN}/item?id={best}'))


def demo_script(mode):
    """Seed localStorage with sample HN+ state taken from the item snapshot."""
    item = open(os.path.join(PAGES_DIR, 'item.html')).read()
    item_id = re.search(r'<tr class="athing submission" id="(\d+)"', item).group(1)
    comment_ids = sorted(int(i) for i in re.findall(r'<tr class="athing comtr" id="(\d+)"', item))
    authors = []
    for a in re.findall(r'<span class="comhead"><a href="user\?id=([^"]+)"', item):
        if a not in authors:
            authors.append(a)
    users = {}
    if len(authors) > 1:
        users[authors[1]] = {'alias': 'The Oracle', 'color': '#a78bfa', 'note': 'Reliably thoughtful. Worth reading first.'}
    if len(authors) > 2:
        users[authors[2]] = {'tag': 'pragmatist', 'color': '#2dd4bf'}
    seen = {item_id: {'max': comment_ids[-min(8, len(comment_ids))] if comment_ids else 0, 'n': 0, 't': 0}}
    front = open(os.path.join(PAGES_DIR, 'front.html')).read()
    for sid, n in re.findall(r'item\?id=(\d+)">(\d+)&nbsp;comments', front)[2:4]:
        seen.setdefault(sid, {'max': 1, 'n': max(0, int(n) - 17), 't': 0})
    state = {
        'settings': {'swaps': [{'from': 'AI', 'to': 'spicy autocomplete'}]},
        'users': users,
        'seen': seen,
    }
    seed = ';'.join(f"localStorage.setItem('gm_{k}', {json.dumps(json.dumps(v))})" for k, v in state.items())
    after = ''
    if mode == 'settings':
        after = "document.dispatchEvent(new KeyboardEvent('keydown',{key:',',bubbles:true}));"
    elif mode == 'card' and len(authors) > 1:
        after = (f"const a=document.querySelector('a.hnp-user[data-hnp-user=\"{authors[1]}\"]');"
                 "window.scrollTo(0,a.getBoundingClientRect().top+scrollY-110);"
                 "setTimeout(()=>a.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})),400);")
    return (f"<script>{seed};"
            f"addEventListener('DOMContentLoaded',()=>setTimeout(()=>{{{after}}},300));</script>")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/__hnp.js':
            body, ctype = open(SCRIPT, 'rb').read(), 'application/javascript'
        elif path in PAGES:
            html = open(os.path.join(PAGES_DIR, PAGES[path])).read()
            i = html.find('<head>')
            query = dict(q.split('=', 1) if '=' in q else (q, '') for q in self.path.partition('?')[2].split('&') if q)
            demo = demo_script(query['demo']) if 'demo' in query else ''
            html = html[:i] + demo + SHIM + html[i:]
            # HN's own assets resolve against the real site
            for attr, asset in (('href', 'news.css'), ('src', 'hn.js'), ('src', 'y18.svg'), ('src', 's.gif')):
                html = html.replace(f'{attr}="{asset}', f'{attr}="{HN}/{asset}')
            body, ctype = html.encode(), 'text/html; charset=utf-8'
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    snapshot(refresh='--refresh' in sys.argv)
    print(f'HN+ harness on http://localhost:{PORT}/news')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
