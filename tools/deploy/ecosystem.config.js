{
  "apps": [
    {
      "name": "starmap",
      "script": "server/src/index.js",
      "interpreter": "node",
      "cwd": "./",
      "env": {
        "NODE_ENV": "production",
        "PORT": "3000"
      },
      "max_memory_restart": "300M"
    }
  ]
}
