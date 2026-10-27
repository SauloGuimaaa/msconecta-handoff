"""REFERENCIA: cliente do canal (VPS). FATO: trecho literal de publicar_instagram.py (sanitizado).
O servidor que atende /postar-canal NAO esta na VPS: NAO CONFIRMADO como ele posta."""
import requests
def log(m): print(m)

def postar_link_canal_instagram(url_noticia):
    """Posta o link da noticia no Canal de Broadcast do Instagram via
    automacao no PC Windows. Falha aqui NUNCA deve interromper o fluxo
    principal de publicacao - e uma etapa complementar, nao critica."""
    try:
        resp = requests.post(
            'http://<IP_DO_PC_SERVIDOR>:8765/postar-canal',
            json={'url': url_noticia},
            timeout=70
        )
        data = resp.json()
        if data.get('ok'):
            log(f"  Link postado no canal Instagram: {url_noticia}")
            return True
        else:
            log(f"  Aviso: falha ao postar no canal: {data.get('erro', 'erro desconhecido')}")
            return False
    except Exception as e:
        log(f"  Aviso: erro ao chamar rota do canal: {e}")
        return False
