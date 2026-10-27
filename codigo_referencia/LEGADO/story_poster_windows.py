# REFERENCIA (nao executar como esta). Copia sanitizada de story_poster_windows.py.
# FATO: este e o arquivo existente na VPS. NAO CONFIRMADO: que e exatamente o que roda hoje no PC
# (a documentacao interna cita tambem um servidor Node, servidor_publicador.js, nao disponivel na VPS).
# Seletores em PT-BR sem acento ("Nova publicacao", "Concluido") sao os do arquivo; podem estar defasados.
r"""
story_poster_windows.py - Roda no PC Windows (<IP_DO_PC_SERVIDOR>)
Posta story no Instagram via Playwright com link sticker.

Uso:
  python story_poster_windows.py --numero 1 --data 24.05 --link URL --story "C:\...\NOTICIA1-STORY.jpeg"
"""
import argparse
import sys
import os
import time
import subprocess
from pathlib import Path


def log(msg):
    print(f'[story_poster] {msg}', flush=True)


CHROME_EXE = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
CDP_URL = 'http://127.0.0.1:9222'


def _start_chrome_headless(profile_dir):
    """Inicia Chrome headless com debug port e retorna o processo."""
    cmd = [
        CHROME_EXE,
        '--remote-debugging-port=9222',
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--user-data-dir=' + profile_dir,
        '--profile-directory=Default',
    ]
    # Sem DETACHED_PROCESS para funcionar corretamente em session 0
    proc = subprocess.Popen(cmd)
    return proc


def postar_story(story_path: str, link_url: str, numero: int):
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    log(f'Iniciando Playwright - story: {story_path}')
    log(f'Link sticker: {link_url}')

    profile_dir = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data')
    chrome_proc = None

    with sync_playwright() as p:
        browser = None
        page = None

        # Opcao 1: Chrome ja rodando com debug port (sessao 1 com --remote-debugging-port=9222)
        try:
            browser = p.chromium.connect_over_cdp(CDP_URL, timeout=5000)
            ctxs = browser.contexts
            if ctxs and ctxs[0].pages:
                page = ctxs[0].pages[0]
            elif ctxs:
                page = ctxs[0].new_page()
            else:
                page = browser.new_context().new_page()
            log('Conectado ao Chrome via CDP (sessao existente)')
        except Exception as e:
            log(f'CDP indisponivel ({e}) - iniciando Chrome headless...')
            browser = None

        # Opcao 2: Iniciar Chrome headless via subprocess + CDP
        if browser is None:
            chrome_proc = _start_chrome_headless(profile_dir)
            log(f'Chrome headless iniciado (PID {chrome_proc.pid}), aguardando...')
            time.sleep(6)
            try:
                browser = p.chromium.connect_over_cdp(CDP_URL, timeout=15000)
                ctxs = browser.contexts
                if ctxs and ctxs[0].pages:
                    page = ctxs[0].pages[0]
                elif ctxs:
                    page = ctxs[0].new_page()
                else:
                    page = browser.new_context().new_page()
                log('Chrome headless conectado via CDP')
            except Exception as e2:
                log(f'ERRO: Chrome headless nao conectou: {e2}')
                if chrome_proc:
                    chrome_proc.terminate()
                return False

        if page is None:
            log('ERRO: nao conseguiu pagina no Chrome.')
            return False

        try:
            # Navegar para Instagram
            log('Acessando instagram.com...')
            page.goto('https://www.instagram.com/', wait_until='domcontentloaded', timeout=25000)
            time.sleep(3)

            # Clicar no botao criar story
            log('Procurando botao de criar story...')
            page.click('svg[aria-label="Nova publicacao"]', timeout=10000)
            time.sleep(1)

            # Clicar em Story
            page.get_by_text('Story', exact=True).click(timeout=5000)
            time.sleep(1)

            # Upload da imagem
            log('Fazendo upload da imagem...')
            file_input = page.locator('input[type="file"]')
            file_input.set_input_files(story_path)
            time.sleep(3)

            # Adicionar link sticker
            log('Adicionando link sticker...')
            try:
                page.click('svg[aria-label="Sticker"]', timeout=6000)
                time.sleep(1)
                page.get_by_text('Link', exact=True).click(timeout=5000)
                time.sleep(0.5)
                url_input = page.locator('input[placeholder*="URL"], input[type="url"], input[name="url"]').first
                url_input.fill(link_url)
                time.sleep(0.5)
                page.get_by_text('Concluido', exact=False).first.click(timeout=5000)
                time.sleep(1)
                log('Link sticker adicionado!')
            except Exception as e:
                log(f'AVISO: sticker menu falhou: {e}')
                try:
                    page.click('[aria-label*="link" i], [aria-label*="Link"]', timeout=5000)
                    time.sleep(0.5)
                    url_input = page.locator('input').last
                    url_input.fill(link_url)
                    page.keyboard.press('Enter')
                    time.sleep(1)
                except Exception as e2:
                    log(f'AVISO: link sticker nao disponivel: {e2}')

            # Publicar
            log('Publicando story...')
            page.get_by_text('Compartilhar', exact=False).click(timeout=10000)
            time.sleep(5)

            log('STORY_PUBLICADO_OK')
            return True

        except PWTimeout as e:
            log(f'Timeout: {e}')
            try:
                page.screenshot(path=rf'<PASTA_DE_ERROS>\erro_story_{numero}.png')
            except Exception:
                pass
            return False
        except Exception as e:
            log(f'Erro: {e}')
            try:
                page.screenshot(path=rf'<PASTA_DE_ERROS>\erro_story_{numero}.png')
            except Exception:
                pass
            return False
        finally:
            time.sleep(2)
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass

    if chrome_proc:
        try:
            chrome_proc.terminate()
        except Exception:
            pass

    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--numero', required=True, type=int)
    parser.add_argument('--data', required=True)
    parser.add_argument('--link', required=True)
    parser.add_argument('--story', required=True)
    args = parser.parse_args()

    if not os.path.exists(args.story):
        log(f'Arquivo nao encontrado: {args.story}')
        sys.exit(1)

    ok = postar_story(args.story, args.link, args.numero)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
