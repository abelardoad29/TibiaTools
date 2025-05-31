import requests
import asyncio


def fetch_boosted_creatures():
    try:
        response_boosted = requests.get("https://api.tibialabs.com/v3/boosted/creature")
        text_boosted = response_boosted.text.strip()
        boosted_name = text_boosted.split(":")[-1].strip()

        response_boss = requests.get("https://api.tibialabs.com/v3/boosted/boss")
        text_boss = response_boss.text.strip()
        boss_name = text_boss.split(":")[-1].strip()

        return boosted_name, boss_name
    except Exception as e:
        print(f"Error al obtener boosted creatures: {e}")
        return "Unknown Boosted", "Unknown Boss"


async def fetch_character_data(session, name):
    try:
        async with session.get(f"https://api.tibiadata.com/v4/character/{name}") as resp:
            data = await resp.json()
            if "character" in data and "character" in data["character"]:
                return data["character"]["character"]
            else:
                return None
    except Exception as e:
        print(f"Error fetching character data for {name}: {e}")
        return None
