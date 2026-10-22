"""
mitmproxy 插件：自动捕获并打印武汉公交接口的 openId

用法（PC 上）：
    pip install mitmproxy
    mitmproxy -s scripts/openid_sniffer.py --listen-port 8080

手机端：
    1. 手机与 PC 连同一 WiFi
    2. 手机 WiFi 代理 -> 手动 -> PC 的局域网 IP:8080
    3. 浏览器访问 http://mitm.it 下载并安装证书
    4. 微信里打开「武汉公交」小程序，进入实时公交查询页面
    5. 回到 PC 终端，openId 会自动打印出来

也可以用 mitmweb 看完整请求：
    mitmweb -s scripts/openid_sniffer.py
"""

import json
from mitmproxy import http

TARGET_HOST = "customized.wuhanbus.com"
TARGET_PATH = "/gps-resapi/wechat/bus/"


def response(flow: http.HTTPFlow) -> None:
    """在响应打印时拦截请求，提取并打印 openId"""
    if TARGET_HOST not in flow.request.pretty_host:
        return
    if TARGET_PATH not in flow.request.path:
        return

    # 1) 从 query 参数里取 openId
    openid = flow.request.query.get("openId")

    # 2) 如果 query 里没有，退而从 header 里找
    if not openid:
        for h in ("openId", "openid", "OpenId"):
            if h in flow.request.headers:
                openid = flow.request.headers[h]
                break

    print("\n" + "=" * 70)
    print("[武汉公交] 捕获到请求")
    print(f"  URL      : {flow.request.pretty_url}")
    print(f"  openId   : {openid or '未找到（请检查完整 URL）'}")
    print(f"  全部参数 : {json.dumps(dict(flow.request.query), ensure_ascii=False)}")
    print(f"  请求头   : {json.dumps(dict(flow.request.headers), ensure_ascii=False)}")
    print("=" * 70 + "\n")

    if openid:
        # 写成文件方便直接复制
        with open("openid.txt", "w", encoding="utf-8") as f:
            f.write(openid)
        print(f"  >>> 已保存到 openid.txt\n")
