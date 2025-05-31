import flet as ft
import os
import json
from tibia_tools.api import fetch_boosted_creatures, fetch_character_data

CHARACTER_FILE = "tracked_characters.json"

class TibiaTools(ft.Container):
    def __init__(self, page: ft.Page):
        super().__init__(expand=True)
        self.page = page
        self.page.bgcolor = "#ffffff"
        self.bgcolor = "#ffffff"
        self.dark_white = "#e7e6e9"
        self.grey_color = "#f3f2f2"

        try:
            with open("creature_gifs.json", encoding="utf-8") as f:
                self.creatures = json.load(f)
        except Exception as e:
            print(f"Error cargando creature_gifs.json: {e}")
            self.creatures = {}

        boosted_name, boss_name = fetch_boosted_creatures()
        boosted_gif = self.creatures.get(boosted_name, "assets/placeholder.png")
        boss_gif = self.creatures.get(boss_name, "assets/placeholder.png")

        self.tracked_characters = []
        self.previous_levels = {}
        self.events_column = ft.Column(spacing=5)

        self.name_field = ft.TextField(label="Nombre del personaje", width=200)
        self.add_player_button = ft.IconButton(icon=ft.Icons.ADD, on_click=self.add_player_from_input)

        self.load_characters_from_file()

        # Aquí defines el layout igual que antes (menu, columnas, etc)
        # OMITO EL CÓDIGO DE LAYOUT PARA ABREVIAR

        self.page.add(
            ft.Row(
                expand=True,
                controls=[
                    # Controles de UI que definiste (self.menu, self.column_1, self.column_2)
                ]
            )
        )

    def add_player_from_input(self, e):
        name = self.name_field.value.strip()
        if name and name not in self.tracked_characters:
            self.tracked_characters.append(name)
            self.previous_levels[name] = 0
            self.save_characters_to_file()
            self.name_field.value = ""
            self.page.update()

    def load_characters_from_file(self):
        if os.path.exists(CHARACTER_FILE):
            try:
                with open(CHARACTER_FILE, "r", encoding="utf-8") as f:
                    self.tracked_characters = json.load(f)
            except Exception as e:
                print(f"Error cargando personajes: {e}")
                self.tracked_characters = []

    def save_characters_to_file(self):
        try:
            with open(CHARACTER_FILE, "w", encoding="utf-8") as f:
                json.dump(self.tracked_characters, f)
        except Exception as e:
            print(f"Error guardando personajes: {e}")

    async def start_polling(self):
        import aiohttp
        import asyncio
        async with aiohttp.ClientSession() as session:
            while True:
                updated = False
                seen_events = set([c.value for c in self.events_column.controls if isinstance(c, ft.Text)])

                for name in self.tracked_characters:
                    try:
                        character = await fetch_character_data(session, name)
                        if character:
                            deaths = character.get("deaths", [])
                            level = character.get("level", 0)

                            for death in deaths[:1]:
                                death_time = death.get("time")
                                death_reason = death.get("reason", "Unknown")
                                death_date = death_time.split(" ")[0]
                                death_display = f"{name} murió el {death_date} por {death_reason}"

                                if death_display not in seen_events:
                                    self.events_column.controls.insert(0, ft.Text(death_display))
                                    updated = True
                                    seen_events.add(death_display)

                            prev_level = self.previous_levels.get(name, 0)
                            if level > prev_level:
                                lvl_up_text = f"{name} subió a nivel {level}!"
                                if lvl_up_text not in seen_events:
                                    self.events_column.controls.insert(0, ft.Text(lvl_up_text, weight=ft.FontWeight.BOLD))
                                    updated = True
                                    seen_events.add(lvl_up_text)
                                self.previous_levels[name] = level
                            else:
                                self.previous_levels[name] = level
                        else:
                            print(f"Personaje {name} no encontrado o respuesta inválida")
                    except Exception as e:
                        print(f"Error al consultar personaje {name}: {e}")

                if len(self.events_column.controls) > 20:
                    self.events_column.controls = self.events_column.controls[:20]

                if updated:
                    self.page.update()

                await asyncio.sleep(5)
