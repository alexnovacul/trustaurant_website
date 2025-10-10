// Trustaurant Custom JavaScript

// Slick Slider Initialization
$(document).ready(function() {
  $('.single-item').slick({
    infinite: true,
    autoplay: true,
    speed: 500,
    dots: true
  });
});

// Navbar Scroll Effect
$(function () {
  $(document).scroll(function () {
    var $nav = $(".navbar-fixed-top");
    $nav.toggleClass('scrolled-inner', $(this).scrollTop() > $nav.height());
  });
});

// Main Slider Carousel
var myCarousel = document.querySelector('#mainslider');
if (myCarousel) {
  var carousel = new bootstrap.Carousel(myCarousel, {
    interval: 3000
  });
}

// Partner Slider Carousel
var myCarousel2 = document.querySelector('#partnerslider');
if (myCarousel2) {
  var carousel2 = new bootstrap.Carousel(myCarousel2, {
    interval: 1500
  });
}

// Active Navigation Item
$(document).ready(function(){ 
  $(".navbar-nav li").removeClass('active');
  $('#navhome').addClass('active');
});

// Toggle Visibility Function
function toggleVisibility(button) {
  var content = document.getElementById('aboutlongtext');
  if (content.style.display === "none") {
    content.style.display = "block";
    setTimeout(function() {
      content.style.opacity = "1";
      content.style.visibility = "visible";
    }, 10);
    button.textContent = "Hide";
  } else {
    content.style.opacity = "0";
    content.style.visibility = "hidden";
    setTimeout(function() {
      content.style.display = "none";
    }, 500);
    button.textContent = "Learn More";
  }
}