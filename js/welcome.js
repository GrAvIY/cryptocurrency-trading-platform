/* welcome.js */

const TOTAL_SLIDES = 4;
let currentSlide = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Check if we should even be here (though logic is also in other pages)
    if (localStorage.getItem('hasVisited') === 'true') {
        // Optional: Redirect if manually accessed? 
        // For now, let's allow viewing if manually accessed, but functionality is mainly for first time.
    }

    updateSlides();

    // Start Auto Play
    startAutoPlay();

    // Add touch swipe support
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        stopAutoPlay(); // Stop on interaction
    });

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    function handleSwipe() {
        if (touchEndX < touchStartX - 50) {
            nextSlide();
        }
        if (touchEndX > touchStartX + 50) {
            prevSlide();
        }
    }
});

let autoPlayInterval;

function startAutoPlay() {
    stopAutoPlay(); // Clear any existing
    autoPlayInterval = setInterval(() => {
        if (currentSlide < TOTAL_SLIDES - 1) {
            nextSlide();
        } else {
            stopAutoPlay(); // Stop at end
        }
    }, 2000); // 2 seconds per slide
}

function stopAutoPlay() {
    if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
    }
}

function updateSlides() {
    // Update Slide Visibility
    document.querySelectorAll('.slide').forEach((slide, index) => {
        slide.classList.remove('active', 'prev');
        if (index === currentSlide) {
            slide.classList.add('active');
        } else if (index < currentSlide) {
            slide.classList.add('prev'); // For exit animation if we add one
        }
    });

    // Update Dots
    document.querySelectorAll('.dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlide);
    });

    // Update Buttons
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const prevSideBtn = document.getElementById('prevSideBtn');
    const nextSideBtn = document.getElementById('nextSideBtn');

    if (prevBtn) prevBtn.disabled = currentSlide === 0;
    if (prevSideBtn) {
        prevSideBtn.disabled = currentSlide === 0;
        prevSideBtn.style.opacity = currentSlide === 0 ? '0' : '1'; // Hide if disabled
    }

    if (currentSlide === TOTAL_SLIDES - 1) {
        if (nextBtn) nextBtn.style.display = 'none'; // Hide "Next" on last slide
        if (nextSideBtn) {
            nextSideBtn.style.display = 'none';
        }
    } else {
        if (nextBtn) {
            nextBtn.style.display = 'block';
            nextBtn.innerHTML = 'Далее <i class="fas fa-arrow-right ml-2"></i>';
        }
        if (nextSideBtn) {
            nextSideBtn.style.display = 'flex';
        }
    }
}

function nextSlide() {
    stopAutoPlay(); // Stop on interaction
    if (currentSlide < TOTAL_SLIDES - 1) {
        currentSlide++;
        updateSlides();
    }
}

function prevSlide() {
    stopAutoPlay(); // Stop on interaction
    if (currentSlide > 0) {
        currentSlide--;
        updateSlides();
    }
}

function goToSlide(index) {
    stopAutoPlay(); // Stop on interaction
    if (index >= 0 && index < TOTAL_SLIDES) {
        currentSlide = index;
        updateSlides();
    }
}

function finishOnboarding(destination = 'login.html') {
    stopAutoPlay();
    // Set the flag in localStorage
    localStorage.setItem('hasVisited', 'true');

    // Redirect
    // If destination is default index.html but we want to be smart:
    // If skip was clicked -> index.html (or trade.html if index is landing)
    // If register/login clicked -> go there.

    window.location.href = destination;
}
