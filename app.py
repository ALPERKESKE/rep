import os
import logging
import traceback
import re
from flask import Flask, render_template, request, jsonify
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
from nltk.stem.snowball import SnowballStemmer
from googleapiclient.errors import HttpError
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)

# Set up logging
logging.basicConfig(level=logging.DEBUG)

# YouTube API key from environment variable
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY")

youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)

# Initialize German stemmer
stemmer = SnowballStemmer("german")

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
limiter.init_app(app)

@app.route('/')
def index():
    return render_template('index.html')

def is_likely_song(title, description, transcript):
    # Check for music-related keywords in title or description
    music_keywords = ['song', 'music', 'lyric', 'sing', 'chorus', 'verse', 'album', 'official audio']
    if any(keyword in title.lower() or keyword in description.lower() for keyword in music_keywords):
        app.logger.debug(f"Video detected as a song due to keywords in title/description")
        return True
    
    # Check for repetitive patterns in transcript
    if transcript:
        text = ' '.join([entry['text'] for entry in transcript])
        words = text.lower().split()
        word_count = len(words)
        unique_words = len(set(words))
        if word_count > 0 and unique_words / word_count < 0.3:  # If less than 30% of words are unique, likely a song
            app.logger.debug(f"Video detected as a song due to repetitive patterns in transcript")
            return True
    
    return False

def check_video_availability(video_id):
    try:
        video_response = youtube.videos().list(
            part='contentDetails',
            id=video_id
        ).execute()

        if video_response['items']:
            content_details = video_response['items'][0]['contentDetails']
            return 'regionRestriction' not in content_details
        return False
    except Exception as e:
        app.logger.error(f"Error checking video availability: {str(e)}")
        return False

def search_transcript(transcript, query):
    query_words = query.lower().split()
    stemmed_query_words = [stemmer.stem(word) for word in query_words]
    matches = []
    for i, entry in enumerate(transcript):
        text = entry['text'].lower()
        stemmed_text = ' '.join([stemmer.stem(word) for word in text.split()])
        for word in stemmed_query_words:
            if re.search(r'\b' + re.escape(word) + r'\b', stemmed_text):
                start_time = max(0, entry['start'] - 3)
                end_time = min(entry['start'] + entry['duration'] + 2, transcript[-1]['start'] + transcript[-1]['duration'])
                matches.append({
                    'start': start_time,
                    'end': end_time,
                    'text': text
                })
    return matches

@app.route('/search', methods=['POST'])
@limiter.limit('10 per minute')
def search():
    query = request.form.get('query')
    language = request.form.get('language', 'en')
    page_token = request.form.get('page_token', '')
    if not query:
        return jsonify({'error': 'No search query provided'}), 400

    try:
        app.logger.info(f"Received search query: {query}, language: {language}, page_token: {page_token}")
        max_results = 50
        videos = []
        
        search_response = youtube.search().list(
            q=query,
            type='video',
            part='id,snippet',
            maxResults=max_results,
            videoCaption='closedCaption',
            videoType='any',
            relevanceLanguage=language,
            videoDuration='short',
            videoEmbeddable='true',
            pageToken=page_token
        ).execute()
        app.logger.info(f"YouTube API returned {len(search_response.get('items', []))} items")

        next_page_token = search_response.get('nextPageToken', '')

        for item in search_response.get('items', []):
            video_id = item['id']['videoId']
            title = item['snippet']['title']
            thumbnail = item['snippet']['thumbnails']['default']['url']
            description = item['snippet']['description']

            app.logger.debug(f"Processing video: {video_id}")
            if check_video_availability(video_id):
                try:
                    transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=[language])
                    app.logger.debug(f"Transcript fetched: {len(transcript)} entries")

                    if not is_likely_song(title, description, transcript):
                        matches = search_transcript(transcript, query)
                        if matches:
                            video_duration = transcript[-1]['start'] + transcript[-1]['duration']
                            if video_duration > 10:  # Filter out videos shorter than 10 seconds
                                videos.append({
                                    'id': video_id,
                                    'title': title,
                                    'thumbnail': thumbnail,
                                    'description': description,
                                    'transcript': transcript,
                                    'matches': matches,
                                    'match_score': len(matches)
                                })
                except (NoTranscriptFound, TranscriptsDisabled) as transcript_error:
                    app.logger.warning(f"No transcript available for video {video_id}: {str(transcript_error)}")
                except Exception as transcript_error:
                    app.logger.error(f"Error fetching transcript for video {video_id}: {str(transcript_error)}")
            else:
                app.logger.debug(f"Video {video_id} is not available globally, skipping")

        # Sort videos by match_score in descending order
        videos.sort(key=lambda x: x['match_score'], reverse=True)

        # Limit the results to exactly 10 videos
        videos = videos[:10]

        if videos:
            app.logger.info(f"Returning {len(videos)} videos with full transcripts")
            return jsonify({
                'videos': videos,
                'next_page_token': next_page_token
            })
        else:
            app.logger.info("No videos with valid transcripts found")
            return jsonify({'message': 'No videos found with matching transcripts.'}), 404
    except HttpError as e:
        if e.resp.status == 403 and 'quotaExceeded' in str(e):
            app.logger.error('YouTube API quota exceeded')
            return jsonify({'error': 'YouTube API quota exceeded. Please try again later.'}), 429
        else:
            app.logger.error(f'YouTube API error: {str(e)}')
            return jsonify({'error': 'An error occurred while fetching videos. Please try again.'}), 500
    except Exception as e:
        app.logger.error(f"Error in search route: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': 'An unexpected error occurred. Please try again later.'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)