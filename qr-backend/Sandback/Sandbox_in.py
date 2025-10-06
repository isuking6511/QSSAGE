import os

def run_analysis():
    url = os.environ.get("TARGET_URL", "NO_URL_PROVIDED")
    print(" [INSIDE SANDBOX CONTAINER]")
    print(f" Received URL: {url}")
    print(" Analysis complete. (Stub logic)")
    
if __name__ == "__main__":
    run_analysis()