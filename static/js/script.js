document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const languageSelect = document.getElementById('language-select');
    const videoPlayerContainer = document.getElementById('video-player-container');
    const errorContainer = document.getElementById('error-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const newVideosButton = document.getElementById('new-videos-button');

    let player;
    let currentVideoData;
    let currentVideoIndex = 0;
    let currentMatchIndex = 0;
    let videos = [];
    let videosViewed = 0;
    let currentQuery = '';
    let currentLanguage = '';
    let searchQuery = '';
    let nextPageToken = '';
    let isLoading = false;
    let noMoreVideos = false;

    function loadYouTubeIframeAPI() {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    loadYouTubeIframeAPI();

    window.onYouTubeIframeAPIReady = function() {
        initializePlayer();
    }

    function initializePlayer() {
        player = new YT.Player('video-player', {
            height: '360',
            width: '640',
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
        videoPlayerContainer.style.display = 'block';
    }

    function onPlayerReady(event) {
        console.log('YouTube player is ready');
    }

    function onPlayerStateChange(event) {
        if (event.data == YT.PlayerState.PLAYING) {
            updateSubtitles();
        } else if (event.data == YT.PlayerState.ENDED) {
            player.stopVideo();
            updateSubtitleDisplay('');
        }
    }

    function onPlayerError(event) {
        let errorMessage = 'An error occurred while loading the video.';
        switch(event.data) {
            case 2:
                errorMessage = 'The request contains an invalid parameter value.';
                break;
            case 5:
                errorMessage = 'The requested content cannot be played in an HTML5 player.';
                break;
            case 100:
                errorMessage = 'The video requested was not found.';
                break;
            case 101:
            case 150:
                errorMessage = 'This video cannot be played here. Please try another video.';
                break;
        }
        showError(errorMessage);
        playNextVideo();
    }

    function playVideo(videoIndex, matchIndex = 0) {
        console.log(`Playing video ${videoIndex}, match ${matchIndex}`);
        if (videoIndex < videos.length) {
            currentVideoData = videos[videoIndex];
            currentVideoIndex = videoIndex;
            currentMatchIndex = matchIndex;
            if (currentVideoData && currentVideoData.matches.length > 0) {
                const match = currentVideoData.matches[matchIndex];
                player.loadVideoById({
                    videoId: currentVideoData.id,
                    startSeconds: match.start,
                    endSeconds: match.end
                });
                updateSubtitleDisplay(match.text);
            } else {
                player.stopVideo();
                updateSubtitleDisplay('');
            }
            videosViewed++;
            updateVideoSeenInfo();
            updatePreviousButton();
            if (currentVideoIndex === videos.length - 1) {
                loadMoreVideos();
            }
        } else {
            player.stopVideo();
            updateSubtitleDisplay('');
            loadMoreVideos();
        }
    }

    function playNextVideo() {
        if (currentVideoIndex < videos.length - 1) {
            playVideo(currentVideoIndex + 1, 0);
        } else {
            loadMoreVideos();
        }
    }

    function playPreviousVideo() {
        console.log('Playing previous video');
        if (currentVideoIndex > 0) {
            playVideo(currentVideoIndex - 1, 0);
        }
    }

    function updatePreviousButton() {
        const previousButton = document.getElementById('previous-button');
        if (previousButton) {
            previousButton.disabled = currentVideoIndex === 0;
        }
    }

    function updateSubtitles() {
        const currentTime = player.getCurrentTime();
        const currentMatch = currentVideoData.matches[currentMatchIndex];
        
        if (currentTime >= currentMatch.start && currentTime <= currentMatch.end) {
            const highlightedText = highlightSearchQuery(currentMatch.text, searchQuery);
            updateSubtitleDisplay(highlightedText);
        } else {
            updateSubtitleDisplay('');
        }

        setTimeout(updateSubtitles, 100);
    }

    function highlightSearchQuery(text, query) {
        const words = query.toLowerCase().split(' ');
        const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
        return text.replace(regex, match => `<span class="highlight">${match}</span>`);
    }

    function updateVideoSeenInfo() {
        const videoSeenInfo = document.getElementById('video-seen-info');
        if (videoSeenInfo) {
            videosViewed = Math.min(videosViewed, videos.length);
            videoSeenInfo.textContent = `Videos seen: ${videosViewed}/${videos.length}`;
        } else {
            console.error('Video seen info element not found in the DOM');
        }
    }

    function clearVideoPlayer() {
        if (player && player.clearVideo) {
            player.stopVideo();
            player.clearVideo();
        }
        videoPlayerContainer.style.display = 'none';
        updateSubtitleDisplay('');
    }

    function showLoading() {
        loadingIndicator.style.display = 'inline-block';
        isLoading = true;
    }

    function hideLoading() {
        loadingIndicator.style.display = 'none';
        isLoading = false;
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function fetchVideos(isNewSearch = false) {
        if (isLoading || (noMoreVideos && !isNewSearch)) return;

        showLoading();
        isLoading = true;

        try {
            const response = await fetch('/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `query=${encodeURIComponent(currentQuery)}&language=${encodeURIComponent(currentLanguage)}${isNewSearch ? '' : `&page_token=${nextPageToken}`}`,
            });

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('YouTube API quota exceeded. Please try again later.');
                }
                throw new Error('Search failed');
            }

            const data = await response.json();
            console.log('Fetched data:', data);
            if (data.videos && data.videos.length > 0) {
                if (isNewSearch) {
                    videos = data.videos;
                    videosViewed = 0;
                    currentVideoIndex = 0;
                    currentMatchIndex = 0;
                    noMoreVideos = false;
                    newVideosButton.style.display = 'none';
                } else {
                    videos = videos.concat(data.videos);
                }
                nextPageToken = data.next_page_token;
                updateVideoSeenInfo();
                updatePreviousButton();
                if (isNewSearch) {
                    playVideo(0);
                }
            } else {
                noMoreVideos = true;
                if (isNewSearch) {
                    showError('No videos found.');
                } else {
                    console.log('No more videos to load.');
                }
            }
        } catch (error) {
            console.error('Error:', error);
            showError(error.message || 'An error occurred while fetching videos. Please try again.');
        } finally {
            hideLoading();
            isLoading = false;
        }
    }

    function loadMoreVideos() {
        if (!isLoading && !noMoreVideos && nextPageToken) {
            fetchVideos(false);
        }
    }

    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }

    function hideError() {
        errorContainer.textContent = '';
        errorContainer.style.display = 'none';
    }

    function updateSubtitleDisplay(text) {
        const subtitleDisplay = document.getElementById('subtitle-display');
        subtitleDisplay.innerHTML = text;
    }

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearVideoPlayer();
        videoPlayerContainer.style.display = 'block';
        const query = searchInput.value.trim();
        const language = languageSelect.value;

        if (!query) {
            showError('Please enter a search query');
            return;
        }

        currentQuery = query;
        currentLanguage = language;
        searchQuery = query;
        videosViewed = 0;
        nextPageToken = '';

        await fetchVideos(true);
    });

    document.getElementById('previous-button').addEventListener('click', () => {
        playPreviousVideo();
    });

    document.getElementById('replay-button').addEventListener('click', () => {
        playVideo(currentVideoIndex, currentMatchIndex);
    });

    document.getElementById('next-button').addEventListener('click', () => {
        playNextVideo();
    });

    if (newVideosButton) {
        newVideosButton.addEventListener('click', () => {
            fetchVideos(true);
        });
    } else {
        console.error('New Videos button not found in the DOM');
    }

    const debouncedLoadMoreVideos = debounce(() => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
            loadMoreVideos();
        }
    }, 200);

    window.addEventListener('scroll', debouncedLoadMoreVideos);

    console.log('Script loaded and DOMContentLoaded event fired');
});