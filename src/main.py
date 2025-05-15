import flet as ft
from split_loot_view import split_loot_view
from Exp_view import Exp_view
from imbuiments_view import imbuiments

def main(page: ft.Page):
    page.title = "Tibia Toolkit"
    page.theme_mode = ft.ThemeMode.DARK
    page.scroll = ft.ScrollMode.AUTO
    page.window_min_width = 400

    page.selected_index = 0
    body_content = ft.Container(content=ft.Column(expand=True), expand=True)

    app_bar = ft.Container(
        content=ft.Text("🛠️ Tibia Tools", size=20, weight=ft.FontWeight.BOLD, text_align=ft.TextAlign.CENTER),
        height=60,
        alignment=ft.alignment.center,
        padding=ft.padding.symmetric(horizontal=10),
    )

    def update_body(index):
        page.selected_index = index
        body_column = body_content.content
        body_column.controls.clear()
        if index == 0:
            body_column.controls.append(split_loot_view(page))
        elif index == 1:
            body_column.controls.append(Exp_view(page))
        elif index == 2:
            body_column.controls.append(imbuiments(page))
        body_content.update()
        update_nav_selection(index)

    def update_nav_selection(index):
        if hasattr(page, "nav_rail"):
            page.nav_rail.selected_index = index
            page.nav_rail.update()
        if hasattr(page, "nav_bar"):
            page.nav_bar.selected_index = index
            page.nav_bar.update()

    def build_layout():
        page.controls.clear()

    if page.width > 600:
        nav = ft.NavigationRail(
            selected_index=page.selected_index,
            label_type=ft.NavigationRailLabelType.ALL,
            min_width=100,
            min_extended_width=200,
            group_alignment=-0.99,
            destinations=[
                ft.NavigationRailDestination(icon=ft.Icons.ASSESSMENT, label="Split Loot"),
                ft.NavigationRailDestination(icon=ft.Icons.PEOPLE, label="EXP Share"),
                #ft.NavigationRailDestination(icon=ft.Icons.AUTO_AWESOME, label="Imbuiments"),
            ],
            on_change=lambda e: update_body(e.control.selected_index),
        )
        page.nav_rail = nav
        if hasattr(page, "nav_bar"):
            del page.nav_bar

        layout = ft.Column([
            app_bar,
            ft.Row(
                [
                    ft.Container(nav, height=page.height - 60),
                    ft.VerticalDivider(width=1),
                    ft.Container(body_content, expand=True),  # <-- cuerpo se expande
                ],
                expand=True  # <-- el Row se expande también
            )
        ], expand=True)

        page.add(layout)

    else:
        nav_bar = ft.NavigationBar(
            selected_index=page.selected_index,
            destinations=[
                ft.NavigationBarDestination(icon=ft.Icons.ASSESSMENT, label="Split Loot"),
                ft.NavigationBarDestination(icon=ft.Icons.PEOPLE, label="EXP Share"),
                ft.NavigationBarDestination(icon=ft.Icons.AUTO_AWESOME, label="Imbuiments"),
            ],
            on_change=lambda e: update_body(e.control.selected_index),
        )
        page.nav_bar = nav_bar
        if hasattr(page, "nav_rail"):
            del page.nav_rail

        layout = ft.Column(
            [
                app_bar,
                ft.Container(body_content, expand=True),  # <-- también se expande aquí
            ],
            expand=True
        )

        page.navigation_bar = nav_bar
        page.add(layout)

    update_body(page.selected_index)
    page.update()

    page.on_resize = lambda e: build_layout()
    build_layout()
if __name__ == "__main__":
    ft.app(target=main, view=ft.WEB_BROWSER, port=51383)
#ft.app(target=main, host="0.0.0.0", port=51383)

