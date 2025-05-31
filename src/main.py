import flet as ft
import datetime
import json
import requests
from split_loot import split_loot_view
from Exp_view import Exp_view
from imbuiments_view import ImbuementCalculator

day = datetime.datetime.now().strftime("%A")

rashid_locations = {
    "Monday": "Svargrond",
    "Tuesday": "Liberty Bay",
    "Wednesday": "Port Hope",
    "Thursday": "Ankrahmun",
    "Friday": "Darashia",
    "Saturday": "Edron",
    "Sunday": "Carlin"
}

rashid_city = rashid_locations.get(day, "Unknown")


class TibiaTools(ft.Container):
    def __init__(self, page: ft.Page):
        super().__init__(expand=True)
        self.page = page
        self.page.title = "Tibia Tools"
        self.bgcolor = "#ffffff"
        self.dark_white = "#e7e6e9"
        self.grey_color = "#f3f2f2"
        self.darkgrey_color = "#6b6b6b"
        self.page.bgcolor = self.bgcolor
        self.page.theme_mode = ft.ThemeMode.LIGHT



        try:
            with open("creature_gifs.json", encoding="utf-8") as f:
                self.creatures = json.load(f)
        except Exception as e:
            print(f"Error cargando creature_gifs.json: {e}")
            self.creatures = {}

        boosted_name, boss_name = self.fetch_boosted_creatures()
        boosted_gif = self.creatures.get(boosted_name, "assets/placeholder.png")
        boss_gif = self.creatures.get(boss_name, "assets/placeholder.png")

        self.menu = ft.Container(
            width=60,
            margin=10,
            alignment=ft.alignment.center,
            content=ft.Column(
                alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                controls=[
                    ft.Container(
                        width=40,
                        height=40,
                        border_radius=10,
                        bgcolor=self.dark_white,
                        content=ft.IconButton(icon=ft.Icons.MENU_SHARP, icon_color="black")
                    ),
                    ft.Column(
                        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                        controls=[
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.SAFETY_DIVIDER, icon_color="black")),
                            ft.Divider(height=1, color=self.dark_white),
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.PEOPLE_ALT, icon_color="black")),
                            ft.Divider(height=1, color=self.dark_white),
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.ATTACH_MONEY, icon_color="black")),
                            ft.Divider(height=1, color=self.dark_white),
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.MANAGE_HISTORY, icon_color="black")),
                            ft.Divider(height=1, color=self.dark_white),
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.ADD_ALERT, icon_color="black")),
                        ]
                    ),
                    ft.Column(
                        controls=[
                            ft.Container(width=40, height=40, border_radius=10, bgcolor=self.dark_white,
                                         content=ft.IconButton(icon=ft.Icons.SETTINGS, icon_color="black")),
                        ]
                    )
                ]
            )
        )

        fixed_width = 180
        fixed_height = 220

        def create_box(title: str, image_src: str, text: str):
            return ft.Container(
                width=fixed_width,
                height=fixed_height,
                border_radius=10,
                padding=10,
                bgcolor=self.grey_color,
                content=ft.Column(
                    alignment=ft.MainAxisAlignment.CENTER,
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=10,
                    controls=[
                        ft.Text(title, size=14, weight=ft.FontWeight.BOLD, color="black"),
                        ft.Image(src=image_src, width=100, height=100, fit=ft.ImageFit.CONTAIN),
                        ft.Text(
                            text,
                            size=16,
                            weight=ft.FontWeight.BOLD,
                            color="black",
                            max_lines=1,
                            overflow=ft.TextOverflow.ELLIPSIS,
                            text_align=ft.TextAlign.CENTER,
                            expand=False,
                            width=fixed_width - 20
                        ),
                    ],
                ),
            )

        self.column_1 = ft.Column(
            expand=1,
            alignment=ft.MainAxisAlignment.CENTER,
            controls=[
                ft.Row(
                    spacing=20,
                    controls=[
                        create_box("Where is Rashid?", "assets/Rashid.gif", rashid_city),
                        create_box("Boosted Creature:", boosted_gif, boosted_name),
                        create_box("Boosted Boss:", boss_gif, boss_name),
                    ],
                ),
                ImbuementCalculator()
            ]
        )

        self.column_2 = ft.Column(
            expand=1,
            alignment=ft.MainAxisAlignment.CENTER,
            controls=[
                ft.Container(
                    expand=1,
                    border_radius=10,
                    padding=20,
                    bgcolor=self.grey_color,
                    content=ft.Column(
                        expand=1,
                        controls=[
                            split_loot_view(self.page)
                        ]
                    ),
                ),
                ft.Container(
                    expand=1,
                    border_radius=10,
                    padding=20,
                    bgcolor=self.grey_color,
                    content=Exp_view(self.page)
                )
            ]
        )

        self.page.add(
            ft.Row(
                expand=True,
                controls=[
                    self.menu,
                    self.column_1,
                    self.column_2,
                ]
            )
        )

    def fetch_boosted_creatures(self):
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


def main(page: ft.Page):
    page.title = "Tibia Tools"
    TibiaTools(page)


ft.app(target=main)
