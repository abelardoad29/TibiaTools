import flet as ft

def imbuiments(page: ft.Page):
    page.title = "Test NavigationRail"
    page.window_min_width = 400

    nav = ft.NavigationRail(
        selected_index=0,
        destinations=[
            ft.NavigationRailDestination(icon=ft.Icons.HOME, label="Home"),
            ft.NavigationRailDestination(icon=ft.Icons.SETTINGS, label="Settings"),
        ],
        on_change=lambda e: print(f"Selected: {e.control.selected_index}")
    )

    # Lo envuelvo en un Column con expand=True para que tome todo el alto
    nav_container = ft.Column([nav], expand=True)

    page.add(
        ft.Row([
            nav_container,
            ft.Text("Contenido principal aquí", expand=True)
        ], expand=True)
    )