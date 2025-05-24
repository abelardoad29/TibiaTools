from selenium import webdriver
from selenium.webdriver.edge.service import Service as EdgeService
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from webdriver_manager.microsoft import EdgeChromiumDriverManager
import time

def is_oriental_trader_active():
    options = Options()
    options.add_argument("--headless")  # Puedes comentar esto para ver la ventana
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")

    driver = webdriver.Edge(service=EdgeService(EdgeChromiumDriverManager().install()), options=options)
    driver.get("https://intibia.com/")

    try:
        wait = WebDriverWait(driver, 10)

        # Esperar el dropdown y seleccionar Ignitera
        select_element = wait.until(EC.presence_of_element_located((By.TAG_NAME, "select")))
        select = Select(select_element)
        select.select_by_visible_text("Ignitera")

        # Esperar a que se actualicen los Mini World Changes
        time.sleep(3)

        # Buscar si hay algún <p> con el texto "Oriental Trader"
        elements = driver.find_elements(By.XPATH, "//div[contains(@class, 'mini-world') or contains(@class, 'group')]//p[text()='Oriental Trader']")
        is_active = len(elements) > 0

    except Exception as e:
        print(f"Error: {e}")
        is_active = False
    finally:
        driver.quit()

    return is_active

# Ejemplo de uso
if is_oriental_trader_active():
    print("✅ Oriental Trader está activo en Ignitera.")
else:
    print("❌ Oriental Trader NO está activo en Ignitera.")
