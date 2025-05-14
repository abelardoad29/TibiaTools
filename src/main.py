import flet as ft
from split_loot_view import split_loot_view

def main(page: ft.Page):

    body_content = ft.Column(expand=True)

    def on_rail_change(e):
        update_body(e.control.selected_index)
    

    rail = ft.NavigationRail(
        selected_index=0,
        label_type=ft.NavigationRailLabelType.ALL,
        min_width=100,
        min_extended_width=400,
        group_alignment=-0.99,
        destinations=[
            ft.NavigationRailDestination(
                icon=ft.Icons.ASSESSMENT_OUTLINED,
                selected_icon=ft.Icons.ASSESSMENT,
                label="Split Loot",
            ),
            ft.NavigationRailDestination(
                icon=ft.Icon(ft.Icons.PEOPLE_ALT_OUTLINED),
                selected_icon=ft.Icon(ft.Icons.PEOPLE),
                label="EXP Share",
            ),
            ft.NavigationRailDestination(
                icon=ft.Icons.AUTO_AWESOME_OUTLINED,
                selected_icon=ft.Icon(ft.Icons.AUTO_AWESOME),
                label="Imbuiments",
            ),
        ],
        on_change=lambda e: update_body(e.control.selected_index),
    )


    page.add(
        ft.Row(
            [
                rail,
                ft.VerticalDivider(width=1),
                body_content,
            ],
            expand=True,
        )
    )

    def update_body(index):
        body_content.controls.clear()
        if index == 0:
            body_content.controls.append(split_loot_view(page))
        elif index == 1:
            body_content.controls.append(ft.Text("Pantalla de EXP Share"))
        elif index == 2:
            body_content.controls.append(ft.Text("Pantalla de Imbuiments"))
        body_content.update()

    update_body(0)

ft.app(main)


