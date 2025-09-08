# VIDEO CATALOG PRO

## ABSTRACT

This solution is a tool for processing my video folder and creating a searchable catalog.

Since I use Linux as my desktop, codecs often fail when I want to view a video, so I needed to write a solution that would allow for this.

The initial solution was to read directly from the folder, but I started experiencing memory allocation issues in the browser and needed a more robust solution that offered simpler viewing. I started by creating a page view, but that fell short of expectations, and I needed to serve the content as a stream.

It was fully developed in collaboration with Google Gemini.

## ARCHITECTURE

The solution currently has three layers:

1. Broker: RabbitMQ is being used to receive processing requests, streaming requests, and database write requests.

2. API and Frontend: The code was built in NestJS, with Swagger to persist data in an SQLite database, which will also facilitate reading by a file indexer. NestJS was also chosen to serve the HTML file with the ServeStatic module.

3. Worker: The worker is responsible for handling processing requests from the broker, transcoding videos, and listing folders for processing, without burdening the API. This was build in NodeJs.

It was designed for use with Docker to orchestrate the application layers.

## BEFORE BUILD

- Edit your docker-compose.yml, at volumes section, to provide your videos local folder:

```
  videos:
    ...
      device: '/media/avmesquita/DADOS/_album/Videos'
  transcoded_videos:
    ...
      device: '/media/avmesquita/DADOS/_album/Transcoded'
```

P.S: 'videos' volume is used to input and 'transcoded_videos' is used to output files.

## BUILD & START

To build and start your project, use:

```
> docker-compose up --build -d
```

## USE

- Access your swagger (http://localhost:3000/api/) and dispatch a POST on /catalog/process or execute:

```
> curl -X POST "http://localhost:3000/catalog/process"
```

- Access your videos on your browser at url http://localhost:3000/videos/






