#!/usr/bin/env python3
"""
Campus-Cloud AI API — 模型呼叫測試
直接填入 API Key 測試模型輸出

使用方式：
    python test_ai_api.py
"""

import json
import time
import httpx

# ─────────────────────────────────────────────
# ★ 填入你的設定
# ─────────────────────────────────────────────
BACKEND_URL = "http://localhost:8000/api/v1"
API_KEY     = "ccai_nXbbbUqCqucKWXGBHtp0zuLH0rJ0ktuU"          # ← 填入你的 ccai_xxx 金鑰
MODEL       = "gpt-oss-20B"               # ← 留空會自動抓第一個可用模型
PROMPT      = "你是什麼模型 200字介紹下"
# ─────────────────────────────────────────────


def header():
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }


def list_models() -> str:
    """查詢可用模型，回傳第一個模型名稱"""
    print("\n[1] 查詢可用模型...")
    with httpx.Client(timeout=15) as client:
        r = client.get(f"{BACKEND_URL}/ai-proxy/models", headers=header())

    if r.status_code != 200:
        print(f"    ✗ 失敗 {r.status_code}: {r.text}")
        return MODEL

    models = r.json().get("data", [])
    if not models:
        print("    ✗ 沒有可用模型")
        return MODEL

    print("    可用模型：")
    for m in models:
        print(f"      - {m['id']}")

    chosen = MODEL or models[0]["id"]
    print(f"    → 使用模型: {chosen}")
    return chosen


def chat(model: str):
    """非串流呼叫"""
    print(f"\n[2] 非串流呼叫")
    print(f"    prompt: {PROMPT}")

    start = time.time()
    with httpx.Client(timeout=120) as client:
        r = client.post(
            f"{BACKEND_URL}/ai-proxy/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": PROMPT}],
                "stream": False,
                "max_tokens": 2048,
            },
            headers=header(),
        )
    elapsed = time.time() - start

    if r.status_code != 200:
        print(f"    ✗ 失敗 {r.status_code}: {r.text}")
        return

    result = r.json()
    reply  = result["choices"][0]["message"]["content"]
    usage  = result.get("usage", {})

    print(f"\n    ── 回應 ({elapsed:.1f}s) ──")
    print(f"    {reply}")
    print(f"\n    tokens → prompt: {usage.get('prompt_tokens','?')}  "
          f"completion: {usage.get('completion_tokens','?')}  "
          f"total: {usage.get('total_tokens','?')}")
    print("    ✓ 成功")


def chat_stream(model: str):
    """串流呼叫"""
    print(f"\n[3] 串流呼叫")
    print(f"    prompt: {PROMPT}")
    print(f"    輸出：", end="", flush=True)

    start = time.time()
    char_count = 0

    try:
        with httpx.stream(
            "POST",
            f"{BACKEND_URL}/ai-proxy/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": PROMPT}],
                "stream": True,
                "max_tokens": 2048,
            },
            headers=header(),
            timeout=120,
        ) as r:
            if r.status_code != 200:
                print(f"\n    ✗ 失敗 {r.status_code}")
                return

            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                chunk_str = line[6:]
                if chunk_str == "[DONE]":
                    break
                try:
                    delta = json.loads(chunk_str)["choices"][0]["delta"].get("content", "")
                    print(delta, end="", flush=True)
                    char_count += len(delta)
                except (json.JSONDecodeError, KeyError):
                    pass

    except httpx.RequestError as e:
        print(f"\n    ✗ 連線錯誤: {e}")
        return

    elapsed = time.time() - start
    print(f"\n    ✓ 成功 ({elapsed:.1f}s，共 {char_count} 字)")


# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  Campus-Cloud AI API 模型測試")
    print(f"  backend : {BACKEND_URL}")
    print(f"  api_key : {API_KEY[:20]}...")
    print("=" * 55)

    if not API_KEY or API_KEY == "ccai_":
        print("\n  ✗ 請先填入 API_KEY！")
        raise SystemExit(1)

    model = list_models()
    chat(model)
    chat_stream(model)

    print("\n" + "=" * 55)
    print("  測試完成")
    print("=" * 55)
